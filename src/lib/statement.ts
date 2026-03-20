import type { Worksheet } from 'exceljs'
import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

export type FlowFilter = 'all' | 'outbound' | 'inbound'

export type StatementTransaction = {
  id: string
  accountType: string
  sheetName: string
  transactedAt: string
  valueDate: string
  description: string
  descriptionCluster: string
  descriptionFingerprint: string
  category: string
  direction: 'outbound' | 'inbound'
  amount: number
  debit: number
  credit: number
  balanceAfter: number | null
  channel: string | null
  reference: string | null
  recipientName: string | null
  recipientAccountNumber: string | null
  counterpartyBank: string | null
  note: string | null
}

export type StatementDataset = {
  fileName: string
  parsedAt: string
  transactions: StatementTransaction[]
  summary: {
    startDate: string
    endDate: string
    transactionCount: number
    accountTypes: string[]
  }
}

export type SummaryMetrics = {
  transactionCount: number
  outboundCount: number
  inboundCount: number
  outboundTotal: number
  inboundTotal: number
  netCashflow: number
  feeTotal: number
  averageDailyOutflow: number
  activeDays: number
  largestExpense: StatementTransaction | null
  largestIncome: StatementTransaction | null
}

export type GroupedMetricRow = {
  key: string
  label: string
  secondary: string | null
  occurrences: number
  outboundTotal: number
  inboundTotal: number
  netCashflow: number
  averageOutbound: number
  firstSeen: string | null
  lastSeen: string | null
  channels: string[]
  sampleDescription: string
}

export type DailyFlowRow = {
  key: string
  day: string
  transactions: number
  spent: number
  received: number
  netCashflow: number
}

const HEADER_WINDOW = 20
const MINIMUM_HEADERS = ['trans date', 'value date', 'description', 'channel']
const DATE_TIME_FORMATS = [
  'DD MMM YYYY HH:mm:ss',
  'D MMM YYYY HH:mm:ss',
  'DD MMM YYYY',
  'D MMM YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD',
]
const FEE_CATEGORIES = new Set(['Bank fee', 'Subscription'])

type RangeValue = [Dayjs | null, Dayjs | null] | null

type ParsedDescription = {
  recipientName: string | null
  recipientAccountNumber: string | null
  counterpartyBank: string | null
  note: string | null
  category: string
  descriptionCluster: string
  descriptionFingerprint: string
}

export async function parseStatementWorkbook(file: File): Promise<StatementDataset> {
  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)

  const transactions = workbook.worksheets.flatMap((worksheet) => parseWorksheet(worksheet.name, worksheet))
  const sortedTransactions = transactions.sort((left, right) => {
    const leftTime = dayjs(left.transactedAt).valueOf()
    const rightTime = dayjs(right.transactedAt).valueOf()
    return leftTime - rightTime
  })

  if (sortedTransactions.length === 0) {
    throw new Error('No transaction rows were found. Use a statement in the same workbook layout as the sample file.')
  }

  return {
    fileName: file.name,
    parsedAt: new Date().toISOString(),
    transactions: sortedTransactions,
    summary: {
      startDate: sortedTransactions[0].valueDate,
      endDate: sortedTransactions.at(-1)?.valueDate ?? sortedTransactions[0].valueDate,
      transactionCount: sortedTransactions.length,
      accountTypes: Array.from(new Set(sortedTransactions.map((transaction) => transaction.accountType))),
    },
  }
}

export function filterTransactions(
  transactions: StatementTransaction[],
  range: RangeValue,
  flowFilter: FlowFilter,
): StatementTransaction[] {
  return transactions.filter((transaction) => {
    if (flowFilter !== 'all' && transaction.direction !== flowFilter) {
      return false
    }

    if (!range) {
      return true
    }

    const [start, end] = range
    const target = dayjs(transaction.valueDate)

    if (start && target.isBefore(start.startOf('day'))) {
      return false
    }

    if (end && target.isAfter(end.endOf('day'))) {
      return false
    }

    return true
  })
}

export function summarizeTransactions(transactions: StatementTransaction[]): SummaryMetrics {
  let outboundTotal = 0
  let inboundTotal = 0
  let outboundCount = 0
  let inboundCount = 0
  let feeTotal = 0
  let largestExpense: StatementTransaction | null = null
  let largestIncome: StatementTransaction | null = null
  const activeDays = new Set<string>()

  for (const transaction of transactions) {
    activeDays.add(transaction.valueDate)

    if (transaction.direction === 'outbound') {
      outboundTotal += transaction.amount
      outboundCount += 1

      if (!largestExpense || transaction.amount > largestExpense.amount) {
        largestExpense = transaction
      }
    } else {
      inboundTotal += transaction.amount
      inboundCount += 1

      if (!largestIncome || transaction.amount > largestIncome.amount) {
        largestIncome = transaction
      }
    }

    if (FEE_CATEGORIES.has(transaction.category) && transaction.direction === 'outbound') {
      feeTotal += transaction.amount
    }
  }

  const activeDayCount = activeDays.size || 1

  return {
    transactionCount: transactions.length,
    outboundCount,
    inboundCount,
    outboundTotal,
    inboundTotal,
    netCashflow: inboundTotal - outboundTotal,
    feeTotal,
    averageDailyOutflow: outboundTotal / activeDayCount,
    activeDays: activeDayCount,
    largestExpense,
    largestIncome,
  }
}

export function buildRecipientRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildGroups(
    transactions.filter((transaction) => transaction.direction === 'outbound'),
    (transaction) =>
      transaction.recipientName?.toLowerCase() ??
      transaction.recipientAccountNumber ??
      transaction.descriptionCluster.toLowerCase(),
    (transaction) => transaction.recipientName ?? transaction.descriptionCluster,
    (transaction) =>
      joinSecondaryParts([transaction.counterpartyBank, transaction.recipientAccountNumber]),
  )
}

export function buildRecipientAccountRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildGroups(
    transactions.filter(
      (transaction) => transaction.direction === 'outbound' && transaction.recipientAccountNumber,
    ),
    (transaction) => transaction.recipientAccountNumber ?? transaction.descriptionFingerprint,
    (transaction) => transaction.recipientAccountNumber ?? 'Unknown account',
    (transaction) => joinSecondaryParts([transaction.recipientName, transaction.counterpartyBank]),
  )
}

export function buildDescriptionRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildGroups(
    transactions.filter((transaction) => transaction.direction === 'outbound'),
    (transaction) => transaction.descriptionFingerprint,
    (transaction) => transaction.descriptionCluster,
    (transaction) => transaction.category,
  )
}

export function buildChannelRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildGroups(
    transactions,
    (transaction) => transaction.channel?.toLowerCase() ?? 'unassigned',
    (transaction) => transaction.channel ?? 'Unassigned',
    (transaction) => transaction.accountType,
  )
}

export function buildAccountTypeRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildGroups(
    transactions,
    (transaction) => transaction.accountType.toLowerCase(),
    (transaction) => transaction.accountType,
    (transaction) => transaction.sheetName,
  )
}

export function buildRecurringRows(transactions: StatementTransaction[]): GroupedMetricRow[] {
  return buildDescriptionRows(transactions)
    .filter((row) => row.occurrences >= 2)
    .sort((left, right) => {
      if (right.occurrences !== left.occurrences) {
        return right.occurrences - left.occurrences
      }

      return right.outboundTotal - left.outboundTotal
    })
}

export function buildDailyRows(transactions: StatementTransaction[]): DailyFlowRow[] {
  const dailyMap = new Map<string, DailyFlowRow>()

  for (const transaction of transactions) {
    const day = transaction.valueDate
    const existing = dailyMap.get(day) ?? {
      key: day,
      day,
      transactions: 0,
      spent: 0,
      received: 0,
      netCashflow: 0,
    }

    existing.transactions += 1

    if (transaction.direction === 'outbound') {
      existing.spent += transaction.amount
    } else {
      existing.received += transaction.amount
    }

    existing.netCashflow = existing.received - existing.spent
    dailyMap.set(day, existing)
  }

  return Array.from(dailyMap.values()).sort((left, right) => right.day.localeCompare(left.day))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDay(day: string): string {
  return dayjs(day).format('DD MMM YYYY')
}

export function formatTimestamp(timestamp: string): string {
  return dayjs(timestamp).format('DD MMM YYYY, HH:mm')
}

function parseWorksheet(sheetName: string, worksheet: Worksheet): StatementTransaction[] {
  const rows: string[][] = []

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    rows.push(
      Array.from({ length: 8 }, (_, index) => normalizeCell(row.getCell(index + 1).text)),
    )
  }

  const headerRowIndex = findHeaderRowIndex(rows)

  if (headerRowIndex < 0) {
    return []
  }

  const accountType = inferAccountType(sheetName)
  const transactions: StatementTransaction[] = []

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const [transDateCell, valueDateCell, descriptionCell, debitCell, creditCell, balanceCell, channelCell, referenceCell] =
      rows[rowIndex]

    if ([transDateCell, valueDateCell, descriptionCell, debitCell, creditCell, balanceCell, channelCell, referenceCell].every((cell) => !cell)) {
      continue
    }

    const transactedAt = parseDateCell(transDateCell)
    const valueDate = parseDateCell(valueDateCell, true)
    const description = descriptionCell.replace(/\s+/g, ' ').trim()

    if (!transactedAt || !valueDate || !description) {
      continue
    }

    const debit = parseMoney(debitCell)
    const credit = parseMoney(creditCell)

    if (debit === 0 && credit === 0) {
      continue
    }

    const parsedDescription = parseDescription(description)
    const direction = debit > 0 ? 'outbound' : 'inbound'
    const amount = direction === 'outbound' ? debit : credit

    transactions.push({
      id: `${sheetName}-${rowIndex + 1}-${referenceCell || transactedAt}`,
      accountType,
      sheetName,
      transactedAt,
      valueDate,
      description,
      descriptionCluster: parsedDescription.descriptionCluster,
      descriptionFingerprint: parsedDescription.descriptionFingerprint,
      category: parsedDescription.category,
      direction,
      amount,
      debit,
      credit,
      balanceAfter: parseMoneyOrNull(balanceCell),
      channel: channelCell || null,
      reference: referenceCell || null,
      recipientName: parsedDescription.recipientName,
      recipientAccountNumber: parsedDescription.recipientAccountNumber,
      counterpartyBank: parsedDescription.counterpartyBank,
      note: parsedDescription.note,
    })
  }

  return transactions
}

function findHeaderRowIndex(rows: string[][]): number {
  let matchIndex = -1

  for (let index = 0; index < Math.min(rows.length, HEADER_WINDOW); index += 1) {
    const normalizedCells = rows[index].map((cell) => normalizeHeader(cell))
    const hasRequiredHeaders = MINIMUM_HEADERS.every((header) => normalizedCells.includes(header))
    const mentionsDebit = normalizedCells.some((cell) => cell.startsWith('debit'))
    const mentionsCredit = normalizedCells.some((cell) => cell.startsWith('credit'))

    if (hasRequiredHeaders && mentionsDebit && mentionsCredit) {
      matchIndex = index
    }
  }

  return matchIndex
}

function normalizeCell(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim()
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function parseDateCell(value: string, dateOnly = false): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()

  if (!normalized || normalized === '--') {
    return null
  }

  for (const format of DATE_TIME_FORMATS) {
    const parsed = dayjs(normalized, format, true)

    if (parsed.isValid()) {
      return (dateOnly ? parsed.startOf('day') : parsed).toISOString()
    }
  }

  const fallback = dayjs(normalized)
  return fallback.isValid() ? (dateOnly ? fallback.startOf('day') : fallback).toISOString() : null
}

function parseMoney(value: string): number {
  const normalized = value.replace(/,/g, '').replace(/₦/g, '').trim()

  if (!normalized || normalized === '--' || normalized.toLowerCase() === 'null') {
    return 0
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseMoneyOrNull(value: string): number | null {
  const parsed = parseMoney(value)
  return parsed === 0 && !/0/.test(value) ? null : parsed
}

function inferAccountType(sheetName: string): string {
  if (/wallet/i.test(sheetName)) {
    return 'Wallet'
  }

  if (/savings/i.test(sheetName)) {
    return 'Savings'
  }

  return sheetName
}

function parseDescription(description: string): ParsedDescription {
  const compact = description.replace(/\s+/g, ' ').trim()
  const parts = compact.split('|').map((part) => part.trim()).filter(Boolean)

  if (/^Transfer to /i.test(compact) || /^Transfer from /i.test(compact)) {
    const firstPart = parts[0] ?? compact
    const recipientName = firstPart.replace(/^Transfer (to|from)\s+/i, '').trim() || null
    const counterpartyBank = parts[1] ?? null
    const accountNumberPart = parts.find((part, index) => index >= 1 && /[\d*]{6,}/.test(part)) ?? null
    const noteStart = accountNumberPart ? parts.indexOf(accountNumberPart) + 1 : 2
    const note = parts.slice(noteStart).join(' | ') || null
    const directionLabel = /^Transfer to /i.test(compact) ? 'Transfer out' : 'Transfer in'

    return {
      recipientName,
      recipientAccountNumber: cleanAccountNumber(accountNumberPart),
      counterpartyBank,
      note,
      category: 'Transfer',
      descriptionCluster: recipientName ? `${directionLabel} · ${recipientName}` : directionLabel,
      descriptionFingerprint: recipientName
        ? `${directionLabel.toLowerCase()}::${recipientName.toLowerCase()}`
        : sanitizeFingerprint(compact),
    }
  }

  if (/card payment/i.test(compact)) {
    const merchant = extractMerchantName(parts)

    return {
      recipientName: merchant,
      recipientAccountNumber: null,
      counterpartyBank: null,
      note: null,
      category: 'Card payment',
      descriptionCluster: merchant ? `Card payment · ${merchant}` : 'Card payment',
      descriptionFingerprint: merchant
        ? `card-payment::${merchant.toLowerCase()}`
        : sanitizeFingerprint(compact),
    }
  }

  if (/^Mobile Data /i.test(compact)) {
    const recipientAccountNumber = cleanAccountNumber(parts[1] ?? null)
    const provider = parts[2] ?? 'Airtime/Data'
    const plan = parts[3] ?? null

    return {
      recipientName: provider,
      recipientAccountNumber,
      counterpartyBank: null,
      note: plan,
      category: 'Connectivity',
      descriptionCluster: plan ? `Connectivity · ${plan}` : `Connectivity · ${provider}`,
      descriptionFingerprint: plan
        ? `connectivity::${plan.toLowerCase()}`
        : `connectivity::${provider.toLowerCase()}`,
    }
  }

  if (/electronic money transfer levy/i.test(compact)) {
    return {
      recipientName: 'Electronic Money Transfer Levy',
      recipientAccountNumber: null,
      counterpartyBank: null,
      note: null,
      category: 'Bank fee',
      descriptionCluster: 'Bank fee · Electronic Money Transfer Levy',
      descriptionFingerprint: 'bank-fee::emtl',
    }
  }

  if (/sms subscription/i.test(compact)) {
    return {
      recipientName: 'SMS Subscription',
      recipientAccountNumber: null,
      counterpartyBank: null,
      note: null,
      category: 'Subscription',
      descriptionCluster: 'Subscription · SMS alerts',
      descriptionFingerprint: 'subscription::sms-alerts',
    }
  }

  if (/voucher package/i.test(compact)) {
    return {
      recipientName: 'Voucher package',
      recipientAccountNumber: null,
      counterpartyBank: null,
      note: null,
      category: 'Subscription',
      descriptionCluster: 'Subscription · Voucher package',
      descriptionFingerprint: 'subscription::voucher-package',
    }
  }

  return {
    recipientName: null,
    recipientAccountNumber: null,
    counterpartyBank: null,
    note: null,
    category: 'Other',
    descriptionCluster: compact,
    descriptionFingerprint: sanitizeFingerprint(compact),
  }
}

function extractMerchantName(parts: string[]): string | null {
  const compact = parts.join(' | ')
  const merchantMatch = compact.match(/(?:\|\s*T\s+|POS\/\d+\/)(.+?)(?:\s{2,}|\sLANG|$)/i)

  if (merchantMatch?.[1]) {
    return merchantMatch[1].replace(/\s+/g, ' ').trim()
  }

  return parts.at(-1) ?? null
}

function cleanAccountNumber(value: string | null): string | null {
  if (!value) {
    return null
  }

  const match = value.match(/[\d*]{6,}/)
  return match?.[0] ?? null
}

function sanitizeFingerprint(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0-9*]{6,}/g, '{account}')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildGroups(
  transactions: StatementTransaction[],
  getKey: (transaction: StatementTransaction) => string,
  getLabel: (transaction: StatementTransaction) => string,
  getSecondary: (transaction: StatementTransaction) => string | null,
): GroupedMetricRow[] {
  const groups = new Map<string, GroupedMetricRow>()

  for (const transaction of transactions) {
    const key = getKey(transaction)
    const existing = groups.get(key) ?? {
      key,
      label: getLabel(transaction),
      secondary: getSecondary(transaction),
      occurrences: 0,
      outboundTotal: 0,
      inboundTotal: 0,
      netCashflow: 0,
      averageOutbound: 0,
      firstSeen: transaction.valueDate,
      lastSeen: transaction.valueDate,
      channels: [],
      sampleDescription: transaction.description,
    }

    existing.occurrences += 1

    if (transaction.direction === 'outbound') {
      existing.outboundTotal += transaction.amount
    } else {
      existing.inboundTotal += transaction.amount
    }

    existing.netCashflow = existing.inboundTotal - existing.outboundTotal
    existing.averageOutbound = existing.outboundTotal / existing.occurrences
    existing.firstSeen =
      existing.firstSeen && existing.firstSeen < transaction.valueDate
        ? existing.firstSeen
        : transaction.valueDate
    existing.lastSeen =
      existing.lastSeen && existing.lastSeen > transaction.valueDate
        ? existing.lastSeen
        : transaction.valueDate

    if (transaction.channel && !existing.channels.includes(transaction.channel)) {
      existing.channels = [...existing.channels, transaction.channel]
    }

    if (!existing.secondary) {
      existing.secondary = getSecondary(transaction)
    }

    groups.set(key, existing)
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (right.outboundTotal !== left.outboundTotal) {
      return right.outboundTotal - left.outboundTotal
    }

    if (right.inboundTotal !== left.inboundTotal) {
      return right.inboundTotal - left.inboundTotal
    }

    return right.occurrences - left.occurrences
  })
}

function joinSecondaryParts(parts: Array<string | null>): string | null {
  const value = parts.filter(Boolean).join(' · ')
  return value || null
}