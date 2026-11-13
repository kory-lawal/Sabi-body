export async function sendNodeResponse(outgoing, response) {
  const body = await response.arrayBuffer();
  const headers = Object.fromEntries(response.headers.entries());
  outgoing.writeHead(response.status, headers);
  outgoing.end(body.byteLength ? Buffer.from(body) : undefined);
}