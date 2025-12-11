from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from backend.database import db, init_db
from backend.routes.clients import clients_bp
from backend.routes.dashboard import dashboard_bp
from backend.routes.invoices import invoices_bp
from backend.routes.settings import settings_bp


def create_app() -> Flask:
    app = Flask(__name__, static_folder="../frontend", static_url_path="/")

    db_path = Path(__file__).resolve().parent.parent / "database" / "invoices.db"
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    init_db(app)
    CORS(app)

    app.register_blueprint(clients_bp)
    app.register_blueprint(invoices_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(settings_bp)

    @app.route("/")
    def serve_frontend():
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)


