from __future__ import annotations

from flask import Flask
from flask_sqlalchemy import SQLAlchemy

# Single shared SQLAlchemy instance for the app.
db = SQLAlchemy()


def init_db(app: Flask, *, create_all: bool = True) -> SQLAlchemy:
    """Initialize the SQLAlchemy extension and optionally create tables."""
    db.init_app(app)
    if create_all:
        with app.app_context():
            db.create_all()
    return db


def get_session():
    """Convenience accessor for the current scoped session."""
    return db.session


def reset_database(app: Flask):
    """Drop and recreate all tables. Useful for local development/tests."""
    with app.app_context():
        db.drop_all()
        db.create_all()
