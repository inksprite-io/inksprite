#!/bin/bash
set -e  # Exit immediately if a command exits with a non-zero status

echo "Installing system dependencies..."

sudo apt update
sudo apt install -y vim
sudo apt install -y git-filter-repo
sudo apt install -y gh