from pathlib import Path
import json
from pglast import parse_sql, parser

# Run after: python -m pip install pglast
source = (Path(__file__).resolve().parents[1] / "database" / "requests.sql").read_text()
statements = parse_sql(source)
functions = json.loads(parser.parse_plpgsql_json(source))
assert len(functions) == 2
print(f"Parsed {len(statements)} SQL statements and {len(functions)} PL/pgSQL functions")
