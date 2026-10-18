from pathlib import Path
import json
from pglast import parse_sql, parser

# Install pglast to run: python -m pip install pglast
source = (Path(__file__).resolve().parents[1] / "database" / "local-activities.sql").read_text()
statements = parse_sql(source)
functions = json.loads(parser.parse_plpgsql_json(source))
assert len(functions) == 3, "Expected all three activity functions to be parsed"
print(f"Parsed {len(statements)} SQL statements and {len(functions)} PL/pgSQL functions")
