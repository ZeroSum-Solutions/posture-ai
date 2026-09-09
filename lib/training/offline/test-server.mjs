import http from 'node:http'

const port = Number(process.env.OFFLINE_TEST_PORT ?? 3187)
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html><head><title>Offline storage test</title></head><body>ready</body></html>')
})

server.listen(port, '127.0.0.1')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
