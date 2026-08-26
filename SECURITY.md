# Security Policy

The package performs pure local planning and hashing. It performs no I/O, network access, SQL execution, dynamic code loading, or migration execution.

Schemas and resolution references may contain sensitive domain names. Consumers decide where plans are persisted or transmitted. A structurally ready plan is not authorization to mutate data; adapters must independently enforce tenancy, backups, transactions, concurrency, rollback, and operator approval.

Report vulnerabilities through https://github.com/FrankFMY without including private production schemas.
