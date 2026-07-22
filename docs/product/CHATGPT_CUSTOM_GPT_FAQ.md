# ChatGPT + Knowledge Hub FAQ (Custom GPT)

**Recommended path today:** use a **dedicated Custom GPT** with KnowAPI **Actions** (OpenAPI + Bearer).  
Do **not** rely on `@KnowHub` in a normal ChatGPT chat — that does not run Custom GPT Actions.  
A future ChatGPT MCP App for normal chats is backlog **NF-004**.

Audience: members who want to search the hub and save summaries/drafts from ChatGPT.

---

## Quick start

1. In Knowledge Hub: **Account → AI connections** → run the setup wizard (ChatGPT client, workspace, read or write).
2. Copy the one-time token and the ChatGPT OpenAPI / auth snippets from the schema step.
3. In ChatGPT: create a Custom GPT → **Actions** → import schema → Bearer auth with the token.
4. Always open **that GPT** to talk to KnowHub (sidebar / GPTs list), not a default chat + `@`.

Technical reference: [`MCP_CURSOR_SETUP.md`](../MCP_CURSOR_SETUP.md) §3.1.

---

## Screenshots

Drop PNG/WebP files into `docs/product/images/chatgpt-faq/` using the names below. Captions match the FAQ sections.

| File | Capture this |
| --- | --- |
| `01-account-ai-connections.png` | Account → **AI connections** with the setup wizard visible |
| `02-wizard-chatgpt-schema.png` | Wizard **Schema** step with ChatGPT selected (OpenAPI + auth panes) |
| `03-chatgpt-create-gpt-actions.png` | ChatGPT → Create GPT → **Actions** / Create new action |
| `04-chatgpt-import-openapi.png` | Import from URL + Authentication = API Key / Bearer |
| `05-open-custom-gpt-not-at.png` | Opening the saved GPT from **GPTs** / sidebar (not `@` in a normal chat) |
| `06-move-prior-chat.png` | Example: paste or “continue from this summary” inside the Custom GPT, then ask it to create a draft record |

Until screenshots exist, follow the text steps; the filenames above are the checklist for whoever captures them.

---

## 1. Set up (Knowledge Hub)

1. Sign in → open **Account → AI connections**.
2. Under **Set up an AI client**, choose **ChatGPT**, pick a workspace you belong to.
3. Use **read-only** first; switch to **draft write** only if the GPT should create/update knowledge records (acts as you).
4. Create the client, **copy the token once**, run connection tests if offered, then open the **Schema** step.
5. Copy:
   - OpenAPI import URL (or full schema), and  
   - Auth hint (Bearer / API key — paste the **raw** token; ChatGPT adds `Bearer`).
6. Click **Finish setup**.

![Account AI connections wizard](images/chatgpt-faq/01-account-ai-connections.png)

![ChatGPT schema in wizard](images/chatgpt-faq/02-wizard-chatgpt-schema.png)

**Admin alternative:** Admin → **LLM / MCP setup** (org-wide options, public URL override, act-as another user). Members should prefer Account → AI connections.

---

## 2. Set up (ChatGPT Custom GPT)

Requires ChatGPT Plus / Team / Enterprise (Custom GPTs + Actions).

1. ChatGPT → **Explore GPTs** → **Create** → **Configure**.
2. Name it clearly (e.g. `KnowHub Agent`).
3. **Actions** → **Create new action**.
4. **Import from URL** (public host only):

   ```text
   https://<your-public-host>/api/v1/llm/openapi.json
   ```

5. **Authentication:** API Key → auth type **Bearer** → paste the hub token (**no** `Bearer ` prefix).
6. Optional instructions, for example:
   - Prefer searching Knowledge Hub before answering from memory.
   - When asked to save work, create/update **draft** knowledge records in the configured workspace.
   - Ask which project/system to attach when unclear.
7. **Save** / **Update**.

![Create GPT Actions](images/chatgpt-faq/03-chatgpt-create-gpt-actions.png)

![Import OpenAPI + Bearer](images/chatgpt-faq/04-chatgpt-import-openapi.png)

---

## 3. How to work best

| Do | Don’t |
| --- | --- |
| Open the **KnowHub Custom GPT** and chat there | Expect `@KnowHub` in a normal chat to call Actions |
| Ask it to list projects / search before writing | Paste secrets into unrelated chats |
| For writes: say “save this as a draft note/plan in workspace X” | Assume cloud ChatGPT can reach `localhost` |
| Keep one GPT per use-case if tokens/scopes differ | Share the bearer token in GPT Store public instructions |

![Open the Custom GPT directly](images/chatgpt-faq/05-open-custom-gpt-not-at.png)

### Good prompts (inside the Custom GPT)

- “List my projects in Knowledge Hub.”
- “Search knowledge for &lt;topic&gt; and summarize what we already decided.”
- “Create a draft knowledge record titled … with this body … in workspace …”
- “Update draft record &lt;id&gt; with the revised summary below.”

---

## 4. Move earlier ChatGPT content into Knowledge Hub

Custom GPT Actions only see what you give them **in that GPT’s thread** (plus what they fetch from the hub). Older chats in the default ChatGPT app are **not** automatically linked.

### Recommended flow

1. In the **old** chat (or export/copy), produce a clean **summary** of what should live in the hub (decisions, open questions, next steps).
2. Open the **KnowHub Custom GPT**.
3. Paste the summary (or say “continue from the following …”).
4. Ask it to **search** first for duplicates, then **create a draft** knowledge record (title, type, project if known).
5. In Knowledge Hub web UI, open the draft, review, and promote/edit as usual.

![Paste prior summary into Custom GPT](images/chatgpt-faq/06-move-prior-chat.png)

### Tips

- Prefer one record per topic over dumping a whole chat log.
- Use conversation **import** in the workspace UI if you have a long paste and want hub-side splitting (`Imports`) — then optionally ask the GPT to refine the draft.
- If the token was lost, **rotate** the client under Account → AI connections (or Admin → API clients) and update the GPT’s Action auth.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `@KnowHub` says integration unavailable | Normal chat ≠ Custom GPT Actions | Open the Custom GPT itself |
| Action 401 / unauthorized | Bad or revoked token | Rotate client; update GPT auth |
| Action fails / timeout | Not public HTTPS, or wrong host | Use `WEB_URL` / public OpenAPI URL, not Docker `api:3101` |
| Search empty | Wrong workspace allowlist | Recreate/rotate client with the right workspace |
| Cannot create records | Read-only scopes | New client with write + acting as you |

More connection tips: Account/Admin wizard **Connection troubleshooting** panel.

---

## Related

* Setup reference: [`../MCP_CURSOR_SETUP.md`](../MCP_CURSOR_SETUP.md)
* Architecture: [`../architecture/MCP_ARCHITECTURE.md`](../architecture/MCP_ARCHITECTURE.md)
* Future normal-chat MCP App: backlog **NF-004** in [`NEXT_FEATURES.md`](NEXT_FEATURES.md)
