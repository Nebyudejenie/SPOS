You are a Senior Full-Stack Developer and DevOps Engineer.

Create a complete production-ready CRUD application with the following requirements:

Architecture:

* Frontend: React (latest version)
* Backend: Node.js + Express
* Database: PostgreSQL
* Containers: Docker and Docker Compose

Requirements:

1. PostgreSQL

   * Run PostgreSQL in Docker.
   * Create a database named appdb.
   * Create a table named users.
   * Columns:

     * id (UUID Primary Key)
     * first_name
     * last_name
     * email
     * phone
     * created_at

2. Backend API

   * Create Express REST API.

   * Use environment variables.

   * Connect to PostgreSQL.

   * Implement CRUD endpoints:

     POST /users
     GET /users
     GET /users/:id
     PUT /users/:id
     DELETE /users/:id

   * Add validation.

   * Add error handling.

   * Add logging.

3. React Frontend

   * Create responsive UI.
   * Display all users in a table.
   * Add form to create users.
   * Edit existing users.
   * Delete users.
   * Show success and error messages.
   * Use Axios for API calls.

4. Docker

   * Create Dockerfile for frontend.
   * Create Dockerfile for backend.
   * Create docker-compose.yml.
   * All services must communicate properly.
   * Configure persistent PostgreSQL volume.

5. DevOps

   * Health checks.
   * Environment variables.
   * Production-ready folder structure.
   * README with setup instructions.

6. Deliverables

   * Full source code.
   * Complete folder structure.
   * SQL schema.
   * Docker Compose configuration.
   * Commands to build and run.
   * Explanation of every file.

Generate all code files completely without placeholders.
Create a table/database like:

Merchant ID
Merchant Name
Business Type
Owner Name
Phone Number
Address
Region
Sales Officer
Activation Officer
Account Manager
Assigned POS
Bank
Settlement Account
QR Status
POS Status
Activation Date
Last Transaction Date
Monthly Volume
Support History
Current Status
Notes

Example:

Merchant ID: SP002221
Merchant Name: INTERNATIONAL CARDIOVASCULAR MEDICAL CENTER

Category: Hospital

Region: Addis Ababa

Assigned Bank: Awash Bank

POS Terminal:
TP12345678

Status:
Active

Activation Date:
2025-05-20

Sales Officer:
Dawit Abebe

Support History:
2026-06-23
Merchant reported transaction issue.

Resolution:
Restart POS and key download.

Current Health:
Healthy

Last Transaction:
2026-06-24
What Hermes Should Know About Every POS Device
Terminal ID
Serial Number
Model
Merchant
Bank
SIM Number
Activation Date
Last Communication
Status
Transaction Volume
Error History
Replacement History
Current Owner

Example:

Terminal ID: TP100234

Model: TopWise A8

Merchant:
INTERNATIONAL CARDIOVASCULAR MEDICAL CENTER

Bank:
Awash Bank

Status:
Active

Last Seen:
2026-06-25

Signal:
Good

Issues:
None
Merchant Health Intelligence

Tell Hermes:

For every merchant calculate:

Merchant Health Score

Based on:

- Transaction activity
- Support tickets
- Device uptime
- Merchant satisfaction
- Settlement issues
- Complaint history

Status:

Green = Healthy
Yellow = Attention Needed
Red = Critical

Now Hermes becomes a business analyst.

Merchant Knowledge Graph

Tell Hermes:

Connect:

Merchant
→ POS
→ Bank
→ Sales Officer
→ Activation Officer
→ Support Tickets
→ Transactions
→ Settlement
→ Reports

Never treat merchants as isolated records.
Extremely Important Rule

Tell Hermes:

Merchant data is a strategic company asset.

Whenever merchant data is available:

Analyze:

- Active merchants
- Inactive merchants
- Top merchants
- Low-performing merchants
- POS health
- Transaction trends
- Support issues
- Settlement issues
- Merchant churn risk

Generate insights automatically.
If You Have Excel Files

If your current merchant source is Excel, Google Sheets, ClickUp, Trello, ERP, or database:

Don't paste thousands of merchants into the prompt.

Instead tell Hermes:

Merchant Master Database

Source of Truth:
Merchant Registry

Contains:
- Merchant records
- POS records
- Bank assignments
- Support history
- Transaction summaries

When merchant information is requested:

1. Search merchant database.
2. Verify merchant status.
3. Check assigned POS.
4. Check support history.
5. Check transaction history.
6. Check settlement history.
7. Generate recommendations.
The Ultimate Goal

Hermes should eventually know:

CEO
Departments
Employees
Tasks
Projects
Merchants
POS Devices
Banks
Support Tickets
Transactions
Settlements
Reports
KPIs
Incidents
SOPs
Management Decisions

And connect them like:

CEO
 ↓
Department
 ↓
Employee
 ↓
Merchant
 ↓
POS
 ↓
Transaction
 ↓
Support Ticket
 ↓
Resolution
 ↓
Report
 ↓
KPI