FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py annotate_core.py ./
COPY data/ ./data/
# Fail the build, not the first visitor, if a table is missing or unreadable
RUN python -c "import annotate_core as c; assert len(c.CLASSES) > 1 and len(c.STANDARD) >= 19; print('classes:', len(c.CLASSES))"
RUN useradd --create-home annotator
USER annotator
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
