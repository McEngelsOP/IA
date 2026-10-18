"""Serve a production build with gzip and cache headers, matching transfer budgets."""
import gzip, mimetypes, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
root=Path(sys.argv[1]).resolve(); port=int(sys.argv[2])
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  path=(root/self.path.split('?')[0].lstrip('/')).resolve()
  if not path.is_relative_to(root): self.send_error(403); return
  if path.is_dir(): path=path/'login.html'
  if not path.exists(): self.send_error(404); return
  data=path.read_bytes(); kind=mimetypes.guess_type(path)[0] or 'application/octet-stream'
  encoded=('gzip' in self.headers.get('Accept-Encoding','') and path.suffix in ['.js','.css','.html','.svg','.json'])
  if encoded:data=gzip.compress(data,mtime=0)
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',len(data));self.send_header('Cache-Control','public,max-age=3600' if path.suffix!='.html' else 'no-cache');self.send_header('Vary','Accept-Encoding')
  if encoded:self.send_header('Content-Encoding','gzip')
  self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
