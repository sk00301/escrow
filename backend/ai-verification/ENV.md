# Environment configuration

This module reads from the **unified backend `.env`** file located at `backend/.env`.

Copy the template and fill in your values:

```bash
cp backend/.env.example backend/.env
```

The `app/core/config.py` loader checks `../.env` first (the unified file),
then falls back to a local `.env` in this directory if one exists.

See `backend/.env.example` for all available variables and their descriptions.
