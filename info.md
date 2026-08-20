# Research / Context — CAOS Firm Command Centre (from PRD)

## Product
CAOS — "CA Operating System". AI-native practice, compliance & client operating system for Indian Chartered Accountant firms (5–50 employees, 100–2,000 client entities). Positioning: "Your accounting software manages accounts. Your tax software files returns. We manage everything in between." Headline: "The Operating System for Modern CA Firms".

Core promise: "Know what is due, what is missing, who is responsible, and what needs attention — across every client."
Secondary: "Request information once. Use it everywhere."

North-star feel: "A digital senior manager who knows every client, every deadline, every document, every open question and every risk across the CA firm."

## Scope of this build — Module 1: Firm Command Centre (customer showcase demo)
The dashboard must NOT display vanity metrics. It answers: "What requires attention today?"

### Dashboard Section A — Compliance Health
Total active compliances: 1,284 · Completed: 912 · In progress: 215 · Waiting for client: 103 · Under review: 38 · At risk: 16

### Dashboard Section B — Upcoming Deadlines
Table columns: Compliance | Due Date | Clients | Ready | Blocked | Risk
Rows (example): GSTR-1 | 11 Sep | 240 | 198 | 34 | 8 · GSTR-3B | 20 Sep | 240 | 182 | 42 | 16 · TDS | 7 Oct | 94 | 62 | 25 | 7
Clicking a number opens the corresponding client list (drill-down).

### Dashboard Section C — Client Dependency
"48 clients currently blocking 79 compliance tasks." Top blockers: ABC Pvt Ltd — 7 missing items · XYZ LLP — 5 missing items · PQR Industries — 4 missing items.

### Dashboard Section D — Review Queue
"21 items awaiting review": 6 GST reconciliations · 5 TDS returns · 4 ITR computations · 3 financial statements · 3 audit workpapers.

### Dashboard Section E — Firm Risk Alerts
Examples: "GST filing deadline in 48 hours: 18 clients incomplete." · "Partner workload threshold exceeded." · "7 client DSCs expire within 30 days." · "4 engagements do not have signed engagement letters." · "11 invoices are more than 90 days overdue."

### Natural Language Interface — "Ask CAOS"
Partners ask: "Which GST clients are at risk this month?" · "Show all compliance tasks assigned to Rahul." · "Which clients haven't submitted bank statements?" · "Which clients have more than three outstanding compliance items?" · "How many tax audits are assigned to Partner Sharma?" System converts NL → structured queries and shows answer tables/cards.

### Partner Morning Home (PRD §75/§136)
"Good Morning, Pranav Kumar — 17 items need attention today"
- Compliance Risk: 🔴 5 Critical · 🟠 12 At Risk · 🟢 684 On Track
- Waiting for Clients: 28 clients
- Awaiting Review: 14 items
- Team Overload: 3 employees
- Upcoming Deadlines: GST — 5 days · TDS — 12 days · MCA — 18 days
- Ask CAOS: "What should I review first today?"
- Billing: ₹8.4 lakh outstanding
Must be understandable in under 60 seconds.

### AI Partner Assistant example (§137)
"What needs my attention today?" → numbered answer list, e.g.: 1. ABC Pvt Ltd — GSTR-3B: filing due in 3 days, two reconciliation differences unresolved. 2. XYZ Industries — Tax Audit: manager review complete, awaiting partner sign-off. 3. PQR LLP — DSC expires in 9 days. 4. LMN Ltd — GST notice response due within 7 days. 5. RST Pvt Ltd — professional fee invoice ₹1.2 lakh, 74 days overdue.

### Explainable statuses (§85)
Not "GST — Delayed" but "GST — At Risk. Reason: Purchase register not received. Client contacted: 3 times. Last reminder: 14 Aug. Due: 20 Aug. Owner: Rahul."

### Risk scoring (§86)
Risk score 82/100 because: 3 days remaining · 2 documents missing · client usually responds in 4 days · review not started.

## Demo firm dataset (use realistic Indian CA firm data)
- Firm: "Kumar Associates, Chartered Accountants" (or similar). Partner: CA Pranav Kumar. Staff: Rahul, Neha, Amit, Priya (manager).
- Clients: ABC Pvt Ltd (Manufacturing, Pvt Ltd, PAN/GSTIN/CIN), XYZ LLP, PQR Industries, LMN Ltd, RST Pvt Ltd, etc. — 30+ clients for drill-down lists.
- Compliance types: GSTR-1, GSTR-3B, TDS (24Q/26Q), ITR, Tax Audit, Statutory Audit, MCA (AOC-4/MGT-7), Advance Tax, PF/ESI.
- Workflow states: Not Started → Information Requested → Information Received → Preparation → Internal Review → Client Approval → Ready to File → Filed → Acknowledgement Received → Closed.
- Indian context: ₹ currency (lakh/crore), GSTIN format (e.g. 29ABCDE1234F1Z5), PAN format, FY/AY terms, Sep/Oct due dates.

## Desired pages (guidance for designer — Module 1 showcase)
1. Landing / login-ish entry that frames the product (optional light landing) leading into the app.
2. Command Centre dashboard (the star): sections A–E + Ask CAOS + partner morning greeting.
3. Drill-down views: client lists behind every number (e.g. "18 clients incomplete" → filterable table), compliance-detail view with explainable status + risk score breakdown.
4. Ask CAOS full-page conversational interface with suggested questions and structured answers.
5. Review Queue page (21 items, approve/return actions, reviewer comments).
6. Client Dependency / Missing documents page (send reminder / escalate actions).
7. Risk Alerts page (alert list with detail drawers).
8. Reports snapshot (compliance status, upcoming deadlines) — optional.

This is a showcase for prospective CA-firm customers: it must feel premium, trustworthy, professional (financial-services grade), data-dense yet scannable, and every number must be clickable/drillable.
