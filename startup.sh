#!/bin/bash
source ~/persistent_venv/bin/activate
cd backend/
pip install -r requirements.txt
uvicorn main:app --reload
