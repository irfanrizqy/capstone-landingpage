from livereload import Server
from app import app

server = Server(app.wsgi_app)

# Templates
server.watch("templates/*.html")
server.watch("templates/**/*.html")

# Static files
server.watch("static/css/*.css")
server.watch("static/css/**/*.css")
server.watch("static/js/*.js")
server.watch("static/js/**/*.js")
server.watch("static/assets/images/*")

# Python files
server.watch("*.py")
server.watch("routes/*.py")
server.watch("helpers/*.py")

server.serve(
    host="0.0.0.0",
    port=5000,
    debug=True
)