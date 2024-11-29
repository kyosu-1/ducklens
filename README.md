# ducklens

ducklens is a browser-based NGINX log analysis tool using DuckDB-WASM. Designed to help identify performance bottlenecks in web applications.

## Features

- **Client-side Processing**: All analysis runs in the browser - no server required
- **Fast Analysis**: Powered by DuckDB for high-performance log processing
- **Path Normalization**: Automatically normalizes IDs, UUIDs, and query parameters to group similar requests
- **Visual Analysis**: Graph visualization using Recharts

## Key Functions

1. **Request Analysis**
   - Total time and average response time per request
   - P95, P99 percentile values
   - Display of original paths before normalization

2. **Status Code Analysis**
   - Status code distribution by request path
   - Visualization of Success/Redirect/Client Error/Server Error
   - Error status highlighting

3. **Automatic Path Normalization**
   - Numeric IDs (`/users/123` → `/users/:id`)
   - UUIDs (`/users/550e8400-e29b-41d4-a716-446655440000` → `/users/:uuid`)
   - Query Parameters (`?page=1&size=20` → `?page=:param&size=:param`)

## Usage

1. Start the development server:
```bash
npm install
npm run dev
```

2. Access http://localhost:5173 in your browser

3. Either:
   - Upload your NGINX log file (JSON format), or
   - Click "Load Demo Data" to see the tool in action with sample data

## Input File Format

Accepts JSON files in the following format:

```json
[
  {
    "timestamp": "2024-03-20T10:00:00+09:00",
    "remote_addr": "192.168.1.100",
    "request": "/api/user/1/profile",
    "status": 200,
    "request_time": 0.05,
    "http_user_agent": "Mozilla/5.0"
  },
  ...
]
```

## Tech Stack

- [Remix](https://remix.run/)
- [Vite](https://vitejs.dev/)
- [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview)
- [Recharts](https://recharts.org/)
- [Tailwind CSS](https://tailwindcss.com/)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
