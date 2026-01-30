#!/bin/bash
set -e

echo "Creating virtual environment..."
python3 -m venv venv

echo "Upgrading pip..."
./venv/bin/pip install --upgrade pip

echo "Installing dependencies..."
./venv/bin/pip install -e '.[dev]'

echo "Setup complete!"
