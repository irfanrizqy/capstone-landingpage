from livereload import Server
from app import app

server = Server(app.wsgi_app)

server.watch("templates/*.html")
server.watch("static/css/*.css")
server.watch("static/js/*.js")
server.watch("static/assets/images/*")

server.serve(
    host="0.0.0.0",
    port=5000,
    debug=True
)
