Keep the current Raptix design system, layout, typography, colors, spacing, and overall visual style unchanged.

Only update the **Project List** and **Project Workspace member management experience**.

## 1. Improve Project Cards

Redesign the cards on the Project List page so each project card communicates enough information for the user to decide which engagement to enter.

Each Project Card should include:

* Project status: Active / Draft / Completed
* Project name
* Short scope or target type, for example:

  * Web Application
  * External Web Pentest
  * API Security Assessment
* Current phase, for example:

  * Reconnaissance
  * Assessment
  * Exploitation
* Number of Assets
* Number of Findings
* Number of currently active Agents
* Small member avatar group
* Current user's role in the project:

  * Owner
  * Member / Pentester
  * Viewer / Reviewer
* Last activity time
* Three-dot contextual menu
* Clear hover / click state to enter the project

Example structure:

```text
┌───────────────────────────────────┐
│ ACTIVE                        •••  │
│                                   │
│ ACME Web Pentest                  │
│ Web Application                   │
│                                   │
│ Current phase                     │
│ Assessment                        │
│                                   │
│ 24 Assets       7 Findings        │
│ 3 Agents active                   │
│                                   │
│ 👤 👤 👤 +2             Owner     │
│                                   │
│ Updated 14 minutes ago            │
│                         Open →    │
└───────────────────────────────────┘
```

Do not show an arbitrary overall percentage such as “72% engagement progress”.

Use **Current Phase + Status** instead because pentest engagements are not always linear.

Visual requirements:

* Card background: `#FFFFFF`
* Page background: subtle light gray such as `#F7F8FA`
* Primary accent: `#EE0033`
* Use red only for:

  * active state
  * primary CTA
  * selected / hover emphasis
  * important status
* Use subtle border and light shadow
* Card border radius around 10–12px
* On hover:

  * slightly stronger shadow
  * subtle red border or accent
  * show “Open Project →”

Keep the cards clean and professional, not overloaded.

---

## 2. Add Project Members / Role Management

Every Project must support multiple human users.

Add a **Members** section inside the Project Workspace.

The system should support these roles:

### Owner

Can:

* manage project
* add/remove members
* change member roles
* manage project settings
* manage credentials
* control agent execution

### Member / Pentester

Can:

* create chats
* interact with root agent
* interact with subagents
* inspect agents
* use pentest functions
* view assets, findings and logs

### Viewer / Reviewer

Primarily read-only.

Can:

* view shared chats
* inspect assets
* inspect findings
* review project status

Cannot directly execute agent actions.

---

## 3. Members Page

Add a project-level page called:

**Members**

Place it in the Project Workspace sidebar near the bottom, above Project Settings.

Example sidebar:

```text
Overview
Chat
Orchestrator
Phases

Assets
Findings

Logs / Tool Output
Credentials

Members
Project Settings
```

The Members page should contain:

* Page title: Project Members
* Short description
* Primary button: `Add Member`

Member table columns:

* User
* Email
* Role
* Status
* Last Activity
* Actions

Example:

```text
Project Members                         + Add Member

┌─────────────────────────────────────────────────────────────┐
│ User              Role       Status       Last activity     │
├─────────────────────────────────────────────────────────────┤
│ Steven Duc        Owner      Active       Now              │
│ Nguyen Van A      Member     Active       12 min ago       │
│ Tran Van B        Viewer     Active       Yesterday        │
└─────────────────────────────────────────────────────────────┘
```

For each member, provide a contextual menu:

* Change Role
* Remove from Project

Only authorized users such as Owner should see management actions.

---

## 4. Add Member Flow

Create an `Add Member` modal.

Fields:

* Search user / email
* Select Role

Role options:

* Owner
* Member / Pentester
* Viewer / Reviewer

Show a short explanation below each role so the user understands the level of access before inviting them.

Example:

```text
Add Member

User / Email
[ search user... ]

Role
[ Member / Pentester ▾ ]

Member / Pentester can run agents,
interact with chats and inspect project data.

                 Cancel   Add Member
```

Use `#EE0033` for the primary Add Member action.

---

## 5. Show Members on Project Cards

On the Project List page, display a compact avatar group on each Project Card.

Example:

```text
👤 👤 👤 +2
```

Do not show all users.

Maximum:

* 3 visible avatars
* remaining count as `+N`

Next to the avatar group, show the current user's role in that project.

Example:

```text
👤 👤 👤 +2                     Owner
```

This helps users quickly understand:

* who is collaborating in the engagement
* what access level they personally have

---

## 6. Project Overview Integration

On the Project Overview page, add a compact Members card.

Show:

* up to 4–5 member avatars
* total member count
* roles
* `Manage Members` action for authorized users

Example:

```text
Members

👤 Steven Duc       Owner
👤 Nguyen Van A     Pentester
👤 Tran Van B       Reviewer

+2 more

Manage Members →
```

Do not turn the Overview page into a full member management screen. Full management stays in the Members page.

---

## 7. Important Product Rule

All users and roles are scoped to the selected Project.

A user's role may differ between projects.

Example:

* Project A → Owner
* Project B → Member
* Project C → Viewer

Make the UI reflect the user's role **per project**, not globally.

Do not change the rest of the existing Raptix design.
