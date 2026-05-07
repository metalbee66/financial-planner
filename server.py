"""Simple HTTP server for the Family Planner app.

Uses ThreadingHTTPServer so concurrent requests (e.g. Playwright loading many
ES-module assets in parallel) don't queue behind one another and surface as
ERR_CONNECTION_REFUSED / ERR_ABORTED on the browser side.
"""
import http.server
import os
import webbrowser

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

os.chdir(DIRECTORY)

Handler = http.server.SimpleHTTPRequestHandler

with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
    print(f"Family Planner running at http://localhost:{PORT}")
    webbrowser.open(f"http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
