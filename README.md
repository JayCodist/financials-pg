### Financials Playground

An app for analyzing bank statement and clearly seeing where your money goes

## Run locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the local URL shown in the terminal, typically:

```text
http://localhost:5173
```

## Build for production

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## How to use

1. Open the app in the browser.
2. Upload an account statement workbook in the same Excel format as the sample `.xlsx` file in this repo.
3. Wait for parsing to finish.
4. Use the dashboard to:
	- filter by date range
	- inspect outbound and inbound groupings
	- search the first column of tables
	- click rows to open drilldown modals with matching transactions

## Notes

- The app is built with Vite, React, TypeScript, Ant Design, and ExcelJS.