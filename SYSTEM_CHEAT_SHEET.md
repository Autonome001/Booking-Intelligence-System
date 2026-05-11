# 🧠 Autonome Blueprint: AI Assessment Platform Cheat Sheet

> **Enterprise-Grade AI Audit & Roadmap Intelligence**
> This platform enables consultants to assess enterprise systems, quantify ROI, and generate board-ready AI transformation blueprints.

---

## 🚀 System Architecture & Agents

### 1. The Agent Fleet
*   **Blueprint Agent (The Lead Strategist):** Orchestrates the entire audit workflow. Validates evidence, flags gaps in discovery, and synthesizes cross-departmental insights.
*   **"Blue" (Strategic Advisor):** Provides real-time proactive advice within the UI. Analyzes current navigation and engagement data to suggest "next best actions" for the consultant.
*   **Intake Agent:** Automated market research and profile building. Pulls industry benchmarks and historical data to prepopulate engagement basics.

### 2. Core Platform Modules
*   **Autonome Lens (Audit):** Deep-dive discovery into Systems, Processes, and Steps. Tracks PII/PHI, cycle times, and handoff inefficiencies.
*   **Autonome Insights (Opportunities):** AI-driven identification of automation and agentic candidates. Scores every initiative on Confidence, Effort, and Time-to-Value.
*   **ROI Engine:** High-precision financial modeling. Computes Conservative, Expected, and Aggressive net values with full provenance (traceability to evidence).
*   **Roadmap Builder:** Visualizes the "Waves" of transformation. Handles dependencies and sequences initiatives based on priority scores.

---

## 💬 Slack-Integrated Commands & Workflows

> **Consultant Workflow:** Most assessment triggers and approvals happen directly in Slack to maintain high velocity.

### Primary Slash Commands
*   `/blueprint start [Client Name]` – Initializes a new engagement discovery phase.
*   `/blueprint audit @user` – Assigns a specific process audit or system review to a stakeholder.
*   `/blueprint status` – Summarizes the current completion percentage and missing evidence for an active engagement.
*   `/blueprint report` – Generates a link to the Executive Export Pack for the current engagement.

### Interactive Workflows
*   **Evidence Approval:** When AI extracts data from an uploaded CSV/Export, it posts to Slack for consultant verification.
    *   `[✅ Confirm Accuracy]` | `[📝 Edit Value]` | `[❓ Flag for Review]`
*   **ROI Sensitivity Review:** Triggers when an initiative's ROI exceeds a set threshold (e.g., >$1M), requiring manual senior reviewer sign-off via Slack buttons.
*   **Proactive "Blue" Alerts:** Slack notifications when "Blue" identifies a strategic opportunity that wasn't captured during initial discovery.

---

## 📊 Key Data Models
*   **Engagements:** The root object (Discovery -> Analysis -> Scope Locked -> Completed).
*   **Evidence Items:** The "Source of Truth" (CSV exports, screenshots, SOPs) with a `confidence_weight`.
*   **Initiatives:** Scored opportunities (Automation, Agentic, Integration) mapped to specific process steps.
*   **ROI Results:** Snapshots of financial calculations with `input_hash` for auditability.

---

## 🛠️ Tech Stack
*   **Frontend:** Next.js, TailwindCSS (Premium Dark Mode Aesthetics).
*   **Backend/DB:** Supabase (Postgres) with strict RLS (Row Level Security).
*   **AI:** GPT-4o for strategic reasoning, specialized embeddings for evidence matching.
*   **Deployment:** Railway (Scaleable Node.js environment).
