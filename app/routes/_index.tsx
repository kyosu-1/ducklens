import React, { useState, useEffect } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

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

// クエリ結果の型をチェックしてBigIntを文字列に変換する関数
const formatValue = (value: any): string => {
  if (typeof value === "bigint") {
    return value.toString(); // BigIntを文字列に変換
  }
  return value !== null && value !== undefined ? value.toString() : "-"; // null/undefinedも対処
};

export default function Index() {
  const { initializeDuckDB } = clientLoader();
  const [db, setDb] = useState<AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null);

  useEffect(() => {
    initializeDuckDB().then(({ db, conn }) => {
      setDb(db);
      setConn(conn);
    });
  }, []);

  const [queryResult, setQueryResult] = useState<any[]>([]);
  const [statusCodeStats, setStatusCodeStats] = useState<any[]>([]);
  const [requestTimeStats, setRequestTimeStats] = useState<any | null>(null);
  const [tableSchema, setTableSchema] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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

      // DuckDBにバッファを登録
      await db.registerFileBuffer(file.name, new Uint8Array(buffer));

      // テーブルの作成とデータの読み込み
      await conn.query(`DROP TABLE IF EXISTS logs`);
      await conn.query(`CREATE TABLE logs AS SELECT * FROM read_json_auto('${file.name}')`);

      // スキーマ取得
      const schema = await conn.query(`PRAGMA table_info('logs')`);
      setTableSchema(schema.toArray());

      // クエリ1: トップリクエストランキング
      const topRequests = await conn.query(`
        SELECT request, COUNT(*) AS hits
        FROM logs
        GROUP BY request
        ORDER BY hits DESC
        LIMIT 10;
      `);
      setQueryResult(topRequests.toArray());

      // クエリ2: ステータスコードの分布
      const statusDistribution = await conn.query(`
        SELECT status, COUNT(*) AS count
        FROM logs
        GROUP BY status
        ORDER BY status;
      `);
      setStatusCodeStats(statusDistribution.toArray());

      // クエリ3: リクエスト時間の平均と分散
      const timeStats = await conn.query(`
        SELECT AVG(request_time) AS avg_time, VAR_POP(request_time) AS var_time
        FROM logs;
      `);
      setRequestTimeStats(timeStats.toArray()[0]);
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
      <div className="flex justify-center mb-4">
        <input
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          className="border border-gray-300 rounded p-2"
        />
      </div>
      {loading && <p className="text-center text-blue-500">Loading...</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xl font-semibold mb-2">リクエストランキング</h2>
          <ul className="list-disc ml-6">
            {queryResult.map((row, index) => (
              <li key={index}>
                {row.request}: {formatValue(row.hits)} hits
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-2">ステータスコード分布</h2>
          <ul className="list-disc ml-6">
            {statusCodeStats.map((row, index) => (
              <li key={index}>
                ステータスコード {row.status}: {formatValue(row.count)} 件
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2">リクエスト時間の統計</h2>
        {requestTimeStats && (
          <p>
            平均リクエスト時間: {formatValue(requestTimeStats.avg_time)} 秒<br />
            分散: {formatValue(requestTimeStats.var_time)}
          </p>
        )}
      </div>
      <div className="mt-6">
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
  );
}
