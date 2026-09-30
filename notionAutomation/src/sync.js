import process from "node:process";

const NOTION_API = process.env.NOTION_API_BASE_URL || "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2025-09-03";
const NOTION_TOKEN = process.env.NOTION_TOKEN;

// Data-source IDs workspace Notion
const TASKS_DATA_SOURCE_ID = process.env.TASKS_DATA_SOURCE_ID || "3e6b556a-1207-4b2e-8398-56fbcc85f3ea";
const DAILY_DATA_SOURCE_ID = process.env.DAILY_DATA_SOURCE_ID || "2b7f510a-d292-80bd-8f93-000b555ace88";
const MONTHS_DATA_SOURCE_ID = process.env.MONTHS_DATA_SOURCE_ID || "2b7f510a-d292-8038-978f-000be11b1655";
const TIME_ZONE = process.env.TIME_ZONE || "Europe/Rome";
const DAILY_HOURS = Number(process.env.DAILY_HOURS || 8);
const ASSIGNEE_NAME = process.env.NOTION_ASSIGNEE_NAME || "Cosimo Corbisiero";
const ASSIGNEE_ID = process.env.NOTION_ASSIGNEE_ID || "";

const ACTIVE_STATUSES = new Set(["In progress", "Testing"]);
const MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

function assertConfig() {
  if (!NOTION_TOKEN) {
    throw new Error("Missing required environment variable: NOTION_TOKEN");
  }
}

function localDate(now = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function property(properties, names, expectedType) {
  const aliases = new Set(names);
  for (const [key, value] of Object.entries(properties || {})) {
    if (aliases.has(key) || aliases.has(value?.name)) return value;
  }
  if (expectedType) {
    return Object.values(properties || {}).find((value) => value?.type === expectedType);
  }
  return undefined;
}

function titleText(prop) {
  return (prop?.title || prop?.rich_text || [])
    .map((item) => item.plain_text || item.text?.content || "")
    .join("")
    .trim();
}

function relationIds(prop) {
  return (prop?.relation || []).map((item) => item.id).filter(Boolean);
}

function taskFromPage(page) {
  const status = property(page.properties, ["Status"], "status")?.status?.name;
  const title = titleText(property(page.properties, ["Task name", "Name"], "title"));
  const projectId = relationIds(property(page.properties, ["Project"], "relation"))[0];
  const assigneeProperty =
    property(page.properties, ["Assignee"], "people") ||
    property(page.properties, [], "person");
  const assignees = assigneeProperty?.people || assigneeProperty?.person || [];
  return { id: page.id, title: title || page.id, status, projectId, assignees };
}

function isTaskAssignedToConfiguredUser(task) {
  return task.assignees.some((person) => (
    (ASSIGNEE_ID && person.id === ASSIGNEE_ID) ||
    person.name === ASSIGNEE_NAME
  ));
}

function dailyEntryFromPage(page) {
  const taskId = relationIds(property(page.properties, ["Task"], "relation"))[0];
  const hours = property(page.properties, ["Ore Lavorate"], "number")?.number ?? 0;
  return { id: page.id, taskId, hours: Number(hours) || 0 };
}

function hoursPerTask(taskCount, totalHours = DAILY_HOURS) {
  if (taskCount <= 0) return 0;
  return totalHours / taskCount;
}

async function notion(path, options = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  let payload;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    payload = { raw: body };
  }
  if (!response.ok) {
    const detail = payload.message || payload.raw || response.statusText;
    throw new Error(`Notion API ${response.status}: ${detail}`);
  }
  return payload;
}

async function queryDataSource(dataSourceId, body) {
  const pages = [];
  let start_cursor;
  do {
    const result = await notion(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ ...body, ...(start_cursor ? { start_cursor } : {}) }),
    });
    pages.push(...(result.results || []));
    start_cursor = result.has_more ? result.next_cursor : undefined;
  } while (start_cursor);
  return pages;
}

async function findCurrentMonth() {
  const date = new Date();
  const monthName = MONTH_NAMES[Number(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "numeric",
  }).format(date)) - 1];
  const pages = await queryDataSource(MONTHS_DATA_SOURCE_ID, {
    filter: { property: "Name", title: { equals: monthName } },
    page_size: 10,
  });
  if (!pages[0]) throw new Error(`No Notion month page found for ${monthName}`);
  return pages[0];
}

function pageProperties({ task, today, hours, monthId }) {
  const properties = {
    "Descrizione": {
      title: [{ type: "text", text: { content: task.title.slice(0, 2000) } }],
    },
    "Data": { date: { start: today } },
    "Ore Lavorate": { number: Number(hours.toFixed(2)) },
    "Task": { relation: [{ id: task.id }] },
    "DB Mesi": { relation: [{ id: monthId }] },
  };
  if (task.projectId) {
    properties["Progetto"] = { relation: [{ id: task.projectId }] };
  }
  return properties;
}

async function createDailyEntry(task, today, hours, monthId) {
  return notion("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { data_source_id: DAILY_DATA_SOURCE_ID },
      properties: pageProperties({ task, today, hours, monthId }),
    }),
  });
}

async function updateDailyEntry(pageId, task, today, hours, monthId) {
  return notion(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: pageProperties({ task, today, hours, monthId }),
    }),
  });
}

export async function syncToday({ now = new Date() } = {}) {
  assertConfig();
  const today = localDate(now);
  const [taskPages, dailyPages, monthPage] = await Promise.all([
    queryDataSource(TASKS_DATA_SOURCE_ID, { page_size: 100 }),
    queryDataSource(DAILY_DATA_SOURCE_ID, {
      filter: { property: "Data", date: { equals: today } },
      page_size: 100,
    }),
    findCurrentMonth(),
  ]);

  const scopedTasks = taskPages
    .map(taskFromPage)
    .filter(isTaskAssignedToConfiguredUser);
  const activeTasks = scopedTasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
  
  const dailyEntries = dailyPages.map(dailyEntryFromPage);
  const entriesByTask = new Map();
  for (const page of dailyEntries) {
    if (!page.taskId) continue;
    const entries = entriesByTask.get(page.taskId) || [];
    entries.push(page);
    entriesByTask.set(page.taskId, entries);
  }

  // Calcola quante ore sono già state registrate oggi
  const totalHoursBefore = dailyEntries
    .filter((entry) => entry.taskId && scopedTaskIds.has(entry.taskId))
    .reduce((sum, entry) => sum + entry.hours, 0);

  // Se abbiamo già raggiunto o superato il limite giornaliero (es. 8h), fermati
  const remainingHoursInDay = Math.max(0, DAILY_HOURS - totalHoursBefore);
  if (remainingHoursInDay <= 0 || activeTasks.length === 0) {
    return {
      today,
      activeTasks: activeTasks.length,
      totalHoursBefore,
      allocatedThisRun: 0,
      totalHoursAfter: totalHoursBefore,
      created: 0,
      updated: 0,
      message: remainingHoursInDay <= 0 ? "Limite giornaliero ore raggiunto" : "Nessun task attivo trovato",
    };
  }

  // Per questa esecuzione oraria alloca al massimo 1 ora totale, ma non più delle ore giornaliere rimanenti
  const hourToAllocate = Math.min(1, remainingHoursInDay);
  const perTaskHours = hoursPerTask(activeTasks.length, hourToAllocate);

  let created = 0;
  let updated = 0;

  for (const task of activeTasks) {
    const existing = entriesByTask.get(task.id) || [];
    
    if (existing.length === 0) {
      // Nessuna voce per oggi: crea nuova riga
      await createDailyEntry(task, today, perTaskHours, monthPage.id);
      created += 1;
    } else {
      // Riga esistente: aggiungi la frazione di ora lavorata in questo turno
      const mainEntry = existing[0];
      const newTotalHours = mainEntry.hours + perTaskHours;
      await updateDailyEntry(mainEntry.id, task, today, newTotalHours, monthPage.id);
      updated += 1;
    }
  }

  return {
    today,
    activeTasks: activeTasks.length,
    hoursAddedPerTask: Number(perTaskHours.toFixed(2)),
    totalHoursBefore: Number(totalHoursBefore.toFixed(2)),
    allocatedThisRun: Number(hourToAllocate.toFixed(2)),
    totalHoursAfter: Number((totalHoursBefore + hourToAllocate).toFixed(2)),
    created,
    updated,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncToday()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

export { hoursPerTask, localDate, taskFromPage };
