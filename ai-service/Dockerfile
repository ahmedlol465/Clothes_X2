FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY clothing_ai ./clothing_ai
COPY garment_service.py ./
RUN pip install --no-cache-dir -e .
ENV HF_HOME=/models
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "garment_service:app", "--host", "0.0.0.0", "--port", "8000"]
