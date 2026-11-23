# MCP tool server (tùy chọn)

Raptix có thể gắn vào server **Model Context Protocol** (MCP) ngoài —
ví dụ Kali MCP daemon, HexStrike — và cho agent dùng tool của server đó
cùng với tool built-in.

Tích hợp này **tùy chọn** và **chỉ cộng thêm**: không tải gì nếu bạn
không (a) cài package adapter tùy chọn và (b) chỉ Raptix tới ít nhất 1
MCP server qua biến môi trường.

## 1. Cài adapter

```bash
pip install langchain-mcp-adapters
```

Dependency này **không** nằm trong install cơ bản của `raptix` — ai
không dùng MCP thì không phải cài. Thiếu package này khi đã khai MCP
server, Raptix chỉ log 1 warning và tiếp tục chạy với tool built-in.

## 2. Khai server

Set `RAPTIX_MCP__SERVERS` là 1 JSON object map tên server → config:

```bash
export RAPTIX_MCP__SERVERS='{
  "kali": {"url": "http://localhost:8000/mcp", "transport": "streamable_http"},
  "hex":  {"command": "uvx", "args": ["hexstrike"], "transport": "stdio"}
}'
```

| Field | Cần khi | Ghi chú |
| --- | --- | --- |
| `transport` | luôn (có default tự suy ra) | `streamable_http`, `sse`, hoặc `stdio` |
| `url` | transport HTTP | endpoint server |
| `command` | `stdio` | lệnh khởi chạy |
| `args` | `stdio` (tùy chọn) | danh sách argument CLI |
| `headers` | HTTP (tùy chọn) | header thêm, ví dụ `Authorization` |

JSON sai định dạng, transport không hợp lệ, hoặc server không kết nối
được — đều chỉ **log và bỏ qua**, không bao giờ làm crash agent.

## 3. Tool đã được gắn vào agent thật

`configured_graphs.py::assemble_graph` gọi `discover_mcp(selected_servers)`
rồi ghép thẳng tool trả về vào danh sách tool của specialist lúc dựng
graph — nghĩa là MCP tool đã được nối vào tool list thật của agent, có
thể dùng ngay khi operator chọn server MCP đó cho role tương ứng (không
phải tự động cho mọi agent, mà theo lựa chọn qua
`interfaces/api/specialist_routes.py`).

Dùng trực tiếp trong code nếu cần:

```python
from raptix.execution.tools.mcp import load_mcp_tools, mcp_servers_configured

if mcp_servers_configured():
    tools = await load_mcp_tools()
```
