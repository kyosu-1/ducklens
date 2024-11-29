import React, { useState, useEffect } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';

export function clientLoader() {
  return {
    async initializeDuckDB() {
      const worker = new duckdb_worker();
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(duckdb_wasm);
      const conn = await db.connect();

      return { db, conn };
    },
  };
}

const formatValue = (value: any): string => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value !== null && value !== undefined ? value.toString() : "-";
};

interface PerformanceAnalysis {
  request: string;
  total_requests: bigint;
  avg_time: number;
  max_time: number;
  min_time: number;
  p95_time: number;
  p99_time: number;
  total_time: number;
  original_patterns: string[]; // 追加
}

interface StatusCodeAnalysis {
  request: string;
  status: number;
  count: bigint;
}

interface StatusChartData {
  request: string;
  success: number;
  redirect: number;
  clientError: number;
  serverError: number;
  total: number;
}

export default function Index() {
  const { initializeDuckDB } = clientLoader();
  const [db, setDb] = useState<AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null);
  const [statusCodeStats, setStatusCodeStats] = useState<StatusCodeAnalysis[]>([]);
  const [tableSchema, setTableSchema] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [performanceAnalysis, setPerformanceAnalysis] = useState<PerformanceAnalysis[]>([]);
  const [statusChartData, setStatusChartData] = useState<StatusChartData[]>([]);

  useEffect(() => {
    initializeDuckDB().then(({ db, conn }) => {
      setDb(db);
      setConn(conn);
    });
  }, []);

  const handleDemoData = async () => {
    if (!conn || !db) {
      alert("DBが初期化されていません");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/data/test.json');
      const testData = await response.json();

      await db.registerFileBuffer('demo.json', new TextEncoder().encode(JSON.stringify(testData)));

      await conn.query(`DROP TABLE IF EXISTS logs`);
      await conn.query(`CREATE TABLE logs AS SELECT * FROM read_json_auto('demo.json')`);

      await conn.query(`
        DROP VIEW IF EXISTS normalized_logs;
        CREATE VIEW normalized_logs AS
        WITH query_normalized AS (
          SELECT 
            *,
            REGEXP_REPLACE(request, '([?&][^=]+)=[^&?]*', '\\1=:param', 'g') as with_normalized_params
          FROM logs
        )
        SELECT 
          *,
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(with_normalized_params, '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)', '/:uuid\\1', 'g'),
              '/[0-9]+(/|$)', 
              '/:id\\1',
              'g'
            ),
            '/[0-9]+([?&]|$)',
            '/:id\\1',
            'g'
          ) AS normalized_request
        FROM query_normalized
      `);

      const schema = await conn.query(`PRAGMA table_info('logs')`);
      setTableSchema(schema.toArray());

      const statusDistribution = await conn.query(`
        SELECT 
          normalized_request as request,
          status,
          COUNT(*) AS count
        FROM normalized_logs
        GROUP BY 1, 2
        ORDER BY 1, 2
      `);
      setStatusCodeStats(statusDistribution.toArray());

      const requestAnalysis = await conn.query(`
        SELECT 
          normalized_request as request,
          COUNT(*) as total_requests,
          AVG(request_time) as avg_time,
          MAX(request_time) as max_time,
          MIN(request_time) as min_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY request_time) as p95_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY request_time) as p99_time,
          SUM(request_time) as total_time,
          ARRAY_AGG(request) FILTER (WHERE request != normalized_request) as original_patterns
        FROM normalized_logs 
        GROUP BY normalized_request 
        ORDER BY total_time DESC
        LIMIT 100
      `);
      setPerformanceAnalysis(requestAnalysis.toArray());

      const statusChartAnalysis = await conn.query(`
        WITH status_groups AS (
          SELECT 
            normalized_request as request,
            CAST(COUNT(*) FILTER (WHERE status >= 200 AND status < 300) AS INTEGER) as success,
            CAST(COUNT(*) FILTER (WHERE status >= 300 AND status < 400) AS INTEGER) as redirect,
            CAST(COUNT(*) FILTER (WHERE status >= 400 AND status < 500) AS INTEGER) as client_error,
            CAST(COUNT(*) FILTER (WHERE status >= 500) AS INTEGER) as server_error,
            CAST(COUNT(*) AS INTEGER) as total
          FROM normalized_logs
          GROUP BY normalized_request
          ORDER BY total DESC
          LIMIT 10
        )
        SELECT *
        FROM status_groups
        WHERE total > 0
      `);
      setStatusChartData(statusChartAnalysis.toArray());
    } catch (error) {
      console.error("エラーが発生しました:", error);
      alert("デモデータの読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  };

  // ファイルアップロード処理
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setLoading(true);
    const file = event.target.files?.[0];
    if (!file || !conn) {
      alert("ログファイルを選択してください！");
      setLoading(false);
      return;
    }

    try {
      // ファイルをArrayBufferとして読み込む
      const buffer = await file.arrayBuffer();

      if (!db) {
        alert("DBが初期化されていません");
        setLoading(false);
        return;
      }

      await db.registerFileBuffer(file.name, new Uint8Array(buffer));

      await conn.query(`DROP TABLE IF EXISTS logs`);
      await conn.query(`CREATE TABLE logs AS SELECT * FROM read_json_auto('${file.name}')`);

      await conn.query(`
        DROP VIEW IF EXISTS normalized_logs;
        CREATE VIEW normalized_logs AS
        WITH query_normalized AS (
          SELECT 
            *,
            -- クエリパラメータを正規化
            REGEXP_REPLACE(request, '([?&][^=]+)=[^&?]*', '\\1=:param', 'g') as with_normalized_params
          FROM logs
        )
        SELECT 
          *,
          -- パスパラメータとUUIDを正規化
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(with_normalized_params, '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)', '/:uuid\\1', 'g'),
              '/[0-9]+(/|$)', 
              '/:id\\1',
              'g'
            ),
            '/[0-9]+([?&]|$)',
            '/:id\\1',
            'g'
          ) AS normalized_request
        FROM query_normalized
      `);

      const schema = await conn.query(`PRAGMA table_info('logs')`);
      setTableSchema(schema.toArray());

      const statusDistribution = await conn.query(`
        SELECT 
          normalized_request as request,
          status,
          COUNT(*) AS count
        FROM normalized_logs
        GROUP BY 1, 2
        ORDER BY 1, 2
      `);
      setStatusCodeStats(statusDistribution.toArray());

      const requestAnalysis = await conn.query(`
        SELECT 
          normalized_request as request,
          COUNT(*) as total_requests,
          AVG(request_time) as avg_time,
          MAX(request_time) as max_time,
          MIN(request_time) as min_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY request_time) as p95_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY request_time) as p99_time,
          SUM(request_time) as total_time,
          ARRAY_AGG(request) FILTER (WHERE request != normalized_request) as original_patterns
        FROM normalized_logs 
        GROUP BY normalized_request 
        ORDER BY total_time DESC
        LIMIT 100
      `);
      setPerformanceAnalysis(requestAnalysis.toArray());

      // ステータスコードの集計クエリを更新
      const statusChartAnalysis = await conn.query(`
        WITH status_groups AS (
          SELECT 
            normalized_request as request,
            CAST(COUNT(*) FILTER (WHERE status >= 200 AND status < 300) AS INTEGER) as success,
            CAST(COUNT(*) FILTER (WHERE status >= 300 AND status < 400) AS INTEGER) as redirect,
            CAST(COUNT(*) FILTER (WHERE status >= 400 AND status < 500) AS INTEGER) as client_error,
            CAST(COUNT(*) FILTER (WHERE status >= 500) AS INTEGER) as server_error,
            CAST(COUNT(*) AS INTEGER) as total
          FROM normalized_logs
          GROUP BY normalized_request
          ORDER BY total DESC
          LIMIT 10
        )
        SELECT *
        FROM status_groups
        WHERE total > 0
      `);
      setStatusChartData(statusChartAnalysis.toArray());
    } catch (error) {
      console.error("エラーが発生しました:", error);
      alert("JSONファイルが正しい形式か確認してください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold text-center mb-6">NGINX Log Analyzer</h1>
      <div className="flex justify-center gap-4 mb-4">
        <input
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          className="border border-gray-300 rounded p-2"
        />
        <button
          onClick={handleDemoData}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          デモデータを読み込む
        </button>
      </div>
      {loading && <p className="text-center text-blue-500">Loading...</p>}
      
      <div className="grid grid-cols-1 gap-6">
        <div>
          <h2 className="text-xl font-semibold mb-2">ステータスコード分布（グラフ）</h2>
          <div className="overflow-x-auto">
            <BarChart
              width={1000}
              height={400}
              data={statusChartData}
              margin={{
                top: 20,
                right: 30,
                left: 20,
                bottom: 100
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="request" 
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip 
                formatter={(value: number, name: string) => {
                  const labels = {
                    success: '成功 (2xx)',
                    redirect: 'リダイレクト (3xx)',
                    clientError: 'クライアントエラー (4xx)',
                    serverError: 'サーバーエラー (5xx)'
                  };
                  return [value, labels[name as keyof typeof labels]];
                }}
              />
              <Legend 
                formatter={(value: string) => {
                  const labels = {
                    success: '成功 (2xx)',
                    redirect: 'リダイレクト (3xx)',
                    clientError: 'クライアントエラー (4xx)',
                    serverError: 'サーバーエラー (5xx)'
                  };
                  return labels[value as keyof typeof labels];
                }}
                verticalAlign="top"
                height={36}
              />
              <Bar dataKey="success" stackId="a" fill="#4ade80" />
              <Bar dataKey="redirect" stackId="a" fill="#facc15" />
              <Bar dataKey="clientError" stackId="a" fill="#fb923c" />
              <Bar dataKey="serverError" stackId="a" fill="#f87171" />
            </BarChart>
          </div>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">ステータスコード分布</h2>
          <table className="table-auto border-collapse border border-gray-300 w-full">
            <thead>
              <tr>
                <th className="border border-gray-300 px-4 py-2">正規化パス</th>
                <th className="border border-gray-300 px-4 py-2">ステータスコード</th>
                <th className="border border-gray-300 px-4 py-2">件数</th>
              </tr>
            </thead>
            <tbody>
              {statusCodeStats.map((row, index) => (
                <tr key={index} className={row.status >= 400 ? "bg-red-100" : ""}>
                  <td className="border border-gray-300 px-4 py-2">{row.request}</td>
                  <td className="border border-gray-300 px-4 py-2">{formatValue(row.status)}</td>
                  <td className="border border-gray-300 px-4 py-2">{formatValue(row.count)}</td>
                </tr>
              ))}
              <tr className="font-bold bg-gray-100">
                <td className="border border-gray-300 px-4 py-2">合計</td>
                <td className="border border-gray-300 px-4 py-2">-</td>
                <td className="border border-gray-300 px-4 py-2">
                  {formatValue(statusCodeStats.reduce((sum, row) => sum + row.count, 0n))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">リクエスト分析</h2>
          <table className="table-auto border-collapse border border-gray-300 w-full">
            <thead>
              <tr>
                <th className="border border-gray-300 px-4 py-2">正規化パス</th>
                <th className="border border-gray-300 px-4 py-2">リクエスト数</th>
                <th className="border border-gray-300 px-4 py-2">平均応答時間(s)</th>
                <th className="border border-gray-300 px-4 py-2">P95応答時間(s)</th>
                <th className="border border-gray-300 px-4 py-2">P99応答時間(s)</th>
                <th className="border border-gray-300 px-4 py-2">合計時間(s)</th>
                <th className="border border-gray-300 px-4 py-2">オリジナルパスの例</th>
              </tr>
            </thead>
            <tbody>
              {performanceAnalysis.map((row, index) => (
                <tr key={index} className={row.avg_time > 0.1 ? "bg-red-100" : ""}>
                  <td className="border border-gray-300 px-4 py-2">{row.request}</td>
                  <td className="border border-gray-300 px-4 py-2">{formatValue(row.total_requests)}</td>
                  <td className="border border-gray-300 px-4 py-2">{Number(row.avg_time).toFixed(3)}</td>
                  <td className="border border-gray-300 px-4 py-2">{Number(row.p95_time).toFixed(3)}</td>
                  <td className="border border-gray-300 px-4 py-2">{Number(row.p99_time).toFixed(3)}</td>
                  <td className="border border-gray-300 px-4 py-2">{Number(row.total_time).toFixed(3)}</td>
                  <td className="border border-gray-300 px-4 py-2 text-sm">
                    {row.original_patterns && row.original_patterns.length > 0 ? (
                      <details>
                        <summary>例を表示</summary>
                        <ul className="list-disc ml-4">
                          {Array.from(new Set(row.original_patterns)).slice(0, 3).map((pattern, i) => (
                            <li key={i}>{pattern}</li>
                          ))}
                          {row.original_patterns.length > 3 && <li>...</li>}
                        </ul>
                      </details>
                    ) : "正規化なし"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold mb-2">テーブルスキーマ</h2>
          <table className="table-auto border-collapse border border-gray-300 w-full">
            <thead>
              <tr>
                <th className="border border-gray-300 px-4 py-2">列名</th>
                <th className="border border-gray-300 px-4 py-2">型</th>
                <th className="border border-gray-300 px-4 py-2">null可能</th>
              </tr>
            </thead>
            <tbody>
              {tableSchema.map((row, index) => (
                <tr key={index}>
                  <td className="border border-gray-300 px-4 py-2">{row.name}</td>
                  <td className="border border-gray-300 px-4 py-2">{row.type}</td>
                  <td className="border border-gray-300 px-4 py-2">
                    {row.nullable ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
