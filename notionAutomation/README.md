# Notion – ore giornaliere dei task

GitHub Action che ogni ora sincronizza la giornata corrente nel database **DB Diario** di Notion.

## Logica

- considera solo i task con stato `In progress` o `Testing`;
- distribuisce `8 / numero_task_attivi` ore a ciascun task;
- crea una sola registrazione per combinazione `Data + Task`;
- aggiorna le registrazioni già presenti quando cambia il numero di task attivi;
- compila `Task`, `Progetto`, `Data`, `Ore Lavorate` e `DB Mesi`;
- quando un task passa a `Done`, viene escluso dai calcoli successivi. La registrazione già esistente non viene cancellata, così rimane nello storico.

La data è calcolata nel fuso `Europe/Rome`, non in UTC.

## Configurazione GitHub

1. Crea un'integrazione interna Notion e copia il suo token.
2. Condividi con l'integrazione la pagina `Time Tracker & Progetti` (l'accesso si propaga ai database contenuti).
3. Nel repository GitHub crea il secret Actions `NOTION_TOKEN`.
4. Abilita Actions e avvia il workflow manualmente una prima volta da **Actions → Sync Notion daily hours → Run workflow**.

Il workflow poi viene eseguito ogni ora. GitHub può ritardare i cron dei repository inattivi; il workflow manuale serve per il primo controllo.
