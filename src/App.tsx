import { startTransition, useDeferredValue, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  DatePicker,
  Empty,
  Progress,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import './App.css'
import {
  buildAccountTypeRows,
  buildChannelRows,
  buildDailyRows,
  buildDescriptionRows,
  buildRecipientAccountRows,
  buildRecipientRows,
  buildRecurringRows,
  filterTransactions,
  formatCurrency,
  formatDay,
  formatTimestamp,
  parseStatementWorkbook,
  summarizeTransactions,
  type FlowFilter,
  type GroupedMetricRow,
  type StatementDataset,
  type StatementTransaction,
} from './lib/statement'

const { RangePicker } = DatePicker
const { Paragraph, Text, Title } = Typography

type RangeValue = [Dayjs | null, Dayjs | null] | null

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dataset, setDataset] = useState<StatementDataset | null>(null)
  const [dateRange, setDateRange] = useState<RangeValue>(null)
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const deferredRange = useDeferredValue(dateRange)

  const filteredTransactions = dataset
    ? filterTransactions(dataset.transactions, deferredRange, flowFilter)
    : []
  const summary = summarizeTransactions(filteredTransactions)
  const recipientRows = buildRecipientRows(filteredTransactions).slice(0, 12)
  const recipientAccountRows = buildRecipientAccountRows(filteredTransactions).slice(0, 12)
  const descriptionRows = buildDescriptionRows(filteredTransactions).slice(0, 12)
  const recurringRows = buildRecurringRows(filteredTransactions).slice(0, 10)
  const channelRows = buildChannelRows(filteredTransactions)
  const accountTypeRows = buildAccountTypeRows(filteredTransactions)
  const dailyRows = buildDailyRows(filteredTransactions).slice(0, 14)
  const feeTransactions = filteredTransactions
    .filter(
      (transaction) =>
        transaction.category === 'Bank fee' || transaction.category === 'Subscription',
    )
    .slice()
    .sort((left, right) => dayjs(right.transactedAt).valueOf() - dayjs(left.transactedAt).valueOf())
    .slice(0, 12)
  const recentTransactions = filteredTransactions
    .slice()
    .sort((left, right) => dayjs(right.transactedAt).valueOf() - dayjs(left.transactedAt).valueOf())
    .slice(0, 18)
  const coveragePct = dataset
    ? Math.round((filteredTransactions.length / dataset.transactions.length) * 100)
    : 0

  const defaultRange = dataset
    ? ([dayjs(dataset.summary.startDate), dayjs(dataset.summary.endDate)] as [Dayjs, Dayjs])
    : null

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setSelectedFile(nextFile)
    setParseError(null)
  }

  const handleAnalyze = async () => {
    if (!selectedFile) {
      setParseError('Choose a statement workbook before starting the analysis.')
      return
    }

    setIsParsing(true)
    setParseError(null)

    try {
      const nextDataset = await parseStatementWorkbook(selectedFile)
      const nextRange: RangeValue = [dayjs(nextDataset.summary.startDate), dayjs(nextDataset.summary.endDate)]

      startTransition(() => {
        setDataset(nextDataset)
        setDateRange(nextRange)
        setFlowFilter('all')
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The workbook could not be parsed.'
      setParseError(message)
    } finally {
      setIsParsing(false)
    }
  }

  const resetDashboard = () => {
    setDataset(null)
    setDateRange(null)
    setFlowFilter('all')
    setSelectedFile(null)
    setParseError(null)
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#14532d',
          borderRadius: 18,
          colorBgLayout: 'transparent',
          colorBgContainer: 'rgba(255,255,255,0.86)',
          colorText: '#15231a',
          fontFamily: 'Avenir Next, Space Grotesk, Inter, sans-serif',
        },
      }}
    >
      <div className="app-shell">
        {!dataset ? (
          <section className="upload-screen">
            <div className="upload-copy">
              <Text className="eyebrow">Personal finance cockpit</Text>
              <Title>Upload a statement, then inspect where your money actually moves.</Title>
              <Paragraph>
                This parser is tuned for the same workbook format as your sample statement. It reads
                wallet and savings sheets, extracts recipients and account numbers where possible,
                and opens a single-page dashboard once parsing is complete.
              </Paragraph>
            </div>

            <Card className="upload-card" bordered={false}>
              <label className="file-picker" htmlFor="statement-upload">
                <span className="file-picker-label">Statement workbook</span>
                <input
                  id="statement-upload"
                  className="file-input"
                  type="file"
                  accept=".xlsx,.xlsm,.xls"
                  onChange={handleFileChange}
                />
                <span className="file-picker-value">
                  {selectedFile?.name ?? 'Choose an Excel statement to begin'}
                </span>
              </label>

              <div className="upload-actions">
                <Button type="primary" size="large" loading={isParsing} onClick={handleAnalyze}>
                  {isParsing ? 'Parsing workbook' : 'Open dashboard'}
                </Button>
                <Text type="secondary">Supported input: account statements in this workbook layout.</Text>
              </div>

              {parseError ? <Alert showIcon type="error" message={parseError} /> : null}
            </Card>
          </section>
        ) : (
          <section className="dashboard-shell">
            <header className="dashboard-header">
              <div>
                <Text className="eyebrow">Loaded workbook</Text>
                <Title level={2}>{dataset.fileName}</Title>
                <Paragraph>
                  {dataset.summary.transactionCount} transactions across{' '}
                  {dataset.summary.accountTypes.join(' and ')} accounts.
                </Paragraph>
              </div>

              <div className="header-actions">
                <Space wrap size="middle">
                  <RangePicker
                    value={dateRange}
                    onChange={(value) => setDateRange(value)}
                    allowClear={false}
                    presets={buildRangePresets(defaultRange)}
                  />
                  <Segmented<FlowFilter>
                    value={flowFilter}
                    onChange={(value) => setFlowFilter(value)}
                    options={[
                      { label: 'All flow', value: 'all' },
                      { label: 'Outbound', value: 'outbound' },
                      { label: 'Inbound', value: 'inbound' },
                    ]}
                  />
                  <Button onClick={resetDashboard}>Analyze another statement</Button>
                </Space>
                <div className="coverage-panel">
                  <div>
                    <Text strong>{filteredTransactions.length}</Text>
                    <Text type="secondary"> visible rows</Text>
                  </div>
                  <Progress percent={coveragePct} showInfo={false} strokeColor="#14532d" />
                </div>
              </div>
            </header>

            {filteredTransactions.length === 0 ? (
              <Card bordered={false} className="empty-card">
                <Empty description="No transactions match this filter." />
              </Card>
            ) : (
              <>
                <section className="stats-grid">
                  <MetricCard title="Money out" value={formatCurrency(summary.outboundTotal)} hint={`${summary.outboundCount} debits`} tone="warn" />
                  <MetricCard title="Money in" value={formatCurrency(summary.inboundTotal)} hint={`${summary.inboundCount} credits`} tone="good" />
                  <MetricCard title="Net flow" value={formatCurrency(summary.netCashflow)} hint={`${summary.activeDays} active days`} tone={summary.netCashflow >= 0 ? 'good' : 'warn'} />
                  <MetricCard title="Average daily spend" value={formatCurrency(summary.averageDailyOutflow)} hint="within selected range" tone="neutral" />
                  <MetricCard title="Fees and subscriptions" value={formatCurrency(summary.feeTotal)} hint="bank charges and recurring services" tone="neutral" />
                </section>

                <section className="insight-strip">
                  <Card bordered={false} className="insight-card">
                    <Statistic
                      title="Largest expense"
                      value={summary.largestExpense ? formatCurrency(summary.largestExpense.amount) : '—'}
                    />
                    <Text type="secondary">
                      {summary.largestExpense
                        ? `${summary.largestExpense.recipientName ?? summary.largestExpense.descriptionCluster} on ${formatDay(summary.largestExpense.valueDate)}`
                        : 'No expense in this range.'}
                    </Text>
                  </Card>
                  <Card bordered={false} className="insight-card">
                    <Statistic
                      title="Largest income"
                      value={summary.largestIncome ? formatCurrency(summary.largestIncome.amount) : '—'}
                    />
                    <Text type="secondary">
                      {summary.largestIncome
                        ? `${summary.largestIncome.recipientName ?? summary.largestIncome.descriptionCluster} on ${formatDay(summary.largestIncome.valueDate)}`
                        : 'No income in this range.'}
                    </Text>
                  </Card>
                  <Card bordered={false} className="insight-card">
                    <Statistic
                      title="Most exposed recipient"
                      value={recipientRows[0] ? formatCurrency(recipientRows[0].outboundTotal) : '—'}
                    />
                    <Text type="secondary">
                      {recipientRows[0]
                        ? `${recipientRows[0].label} across ${recipientRows[0].occurrences} transfers`
                        : 'No outbound recipient exposure in this range.'}
                    </Text>
                  </Card>
                </section>

                <section className="panel-grid two-up">
                  <DashboardTable
                    title="Top outbound recipients"
                    subtitle="Who receives the most from the selected period"
                    rows={recipientRows}
                    columns={groupColumns('recipient')}
                  />
                  <DashboardTable
                    title="Recipient account numbers"
                    subtitle="Useful when the same person uses multiple destination accounts"
                    rows={recipientAccountRows}
                    columns={groupColumns('account')}
                  />
                </section>

                <section className="panel-grid two-up">
                  <DashboardTable
                    title="Spend clusters by description"
                    subtitle="Normalized descriptions show where repeated money movement builds up"
                    rows={descriptionRows}
                    columns={groupColumns('description')}
                  />
                  <DashboardTable
                    title="Channels ranked by flow"
                    subtitle="Which rails move the most money in or out"
                    rows={channelRows}
                    columns={channelColumns}
                  />
                </section>

                <section className="panel-grid two-up">
                  <DashboardTable
                    title="Recurring outbound patterns"
                    subtitle="Repeated spend groups help surface habits and subscriptions"
                    rows={recurringRows}
                    columns={groupColumns('recurring')}
                  />
                  <DashboardTable
                    title="Account split"
                    subtitle="Wallet versus savings exposure inside the chosen period"
                    rows={accountTypeRows}
                    columns={channelColumns}
                  />
                </section>

                <section className="panel-grid two-up">
                  <DashboardTable
                    title="Daily cashflow"
                    subtitle="Track the days with the biggest inflow or burn"
                    rows={dailyRows}
                    columns={dailyColumns}
                  />
                  <DashboardTable
                    title="Fees and subscriptions"
                    subtitle="A quick view of quiet cash leaks"
                    rows={feeTransactions}
                    columns={feeColumns}
                  />
                </section>

                <section className="panel-grid single">
                  <DashboardTable
                    title="Recent transactions"
                    subtitle="The latest parsed rows in the active range"
                    rows={recentTransactions}
                    columns={transactionColumns}
                  />
                </section>
              </>
            )}
          </section>
        )}
      </div>
    </ConfigProvider>
  )
}

function MetricCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string
  value: string
  hint: string
  tone: 'good' | 'warn' | 'neutral'
}) {
  return (
    <Card bordered={false} className={`metric-card metric-card-${tone}`}>
      <Text type="secondary">{title}</Text>
      <Title level={3}>{value}</Title>
      <Text>{hint}</Text>
    </Card>
  )
}

function DashboardTable<T extends object>({
  title,
  subtitle,
  rows,
  columns,
}: {
  title: string
  subtitle: string
  rows: T[]
  columns: Array<Record<string, unknown>>
}) {
  return (
    <Card bordered={false} className="panel-card" title={title} extra={<Text type="secondary">{subtitle}</Text>}>
      <Table
        rowKey={(row) => String((row as { key?: string; id?: string }).key ?? (row as { id?: string }).id)}
        dataSource={rows}
        columns={columns}
        pagination={false}
        scroll={{ x: 920 }}
        locale={{ emptyText: 'No rows to show for this range.' }}
      />
    </Card>
  )
}

function buildRangePresets(range: [Dayjs, Dayjs] | null) {
  if (!range) {
    return []
  }

  const [start, end] = range

  return [
    { label: 'Full statement', value: range },
    { label: 'Last 30 days', value: [end.subtract(29, 'day'), end] as [Dayjs, Dayjs] },
    { label: 'Last 90 days', value: [end.subtract(89, 'day'), end] as [Dayjs, Dayjs] },
    { label: 'Month to date', value: [end.startOf('month'), end] as [Dayjs, Dayjs] },
    { label: 'From first row', value: [start, start.add(29, 'day')] as [Dayjs, Dayjs] },
  ]
}

function renderFlowTag(amount: number, positive: boolean) {
  return <Tag color={positive ? 'green' : 'volcano'}>{formatCurrency(amount)}</Tag>
}

function groupColumns(mode: 'recipient' | 'account' | 'description' | 'recurring') {
  const firstColumnTitle = {
    recipient: 'Recipient',
    account: 'Account number',
    description: 'Description cluster',
    recurring: 'Recurring cluster',
  }[mode]

  return [
    {
      title: firstColumnTitle,
      dataIndex: 'label',
      key: 'label',
      width: 280,
      render: (_value: string, row: GroupedMetricRow) => (
        <div>
          <strong>{row.label}</strong>
          <div className="cell-secondary">{row.secondary ?? row.sampleDescription}</div>
        </div>
      ),
    },
    {
      title: 'Outbound',
      dataIndex: 'outboundTotal',
      key: 'outboundTotal',
      sorter: (left: GroupedMetricRow, right: GroupedMetricRow) => left.outboundTotal - right.outboundTotal,
      render: (value: number) => renderFlowTag(value, false),
    },
    {
      title: 'Occurrences',
      dataIndex: 'occurrences',
      key: 'occurrences',
      sorter: (left: GroupedMetricRow, right: GroupedMetricRow) => left.occurrences - right.occurrences,
    },
    {
      title: 'Average outflow',
      dataIndex: 'averageOutbound',
      key: 'averageOutbound',
      render: (value: number) => formatCurrency(value),
    },
    {
      title: 'Last seen',
      dataIndex: 'lastSeen',
      key: 'lastSeen',
      render: (value: string | null) => (value ? formatDay(value) : '—'),
    },
  ]
}

const channelColumns = [
  {
    title: 'Bucket',
    dataIndex: 'label',
    key: 'label',
    width: 260,
    render: (_value: string, row: GroupedMetricRow) => (
      <div>
        <strong>{row.label}</strong>
        <div className="cell-secondary">{row.secondary ?? row.sampleDescription}</div>
      </div>
    ),
  },
  {
    title: 'Money out',
    dataIndex: 'outboundTotal',
    key: 'outboundTotal',
    render: (value: number) => renderFlowTag(value, false),
  },
  {
    title: 'Money in',
    dataIndex: 'inboundTotal',
    key: 'inboundTotal',
    render: (value: number) => renderFlowTag(value, true),
  },
  {
    title: 'Net',
    dataIndex: 'netCashflow',
    key: 'netCashflow',
    render: (value: number) => <strong>{formatCurrency(value)}</strong>,
  },
  {
    title: 'Count',
    dataIndex: 'occurrences',
    key: 'occurrences',
  },
]

const dailyColumns = [
  {
    title: 'Day',
    dataIndex: 'day',
    key: 'day',
    render: (value: string) => formatDay(value),
  },
  {
    title: 'Spent',
    dataIndex: 'spent',
    key: 'spent',
    render: (value: number) => renderFlowTag(value, false),
  },
  {
    title: 'Received',
    dataIndex: 'received',
    key: 'received',
    render: (value: number) => renderFlowTag(value, true),
  },
  {
    title: 'Net',
    dataIndex: 'netCashflow',
    key: 'netCashflow',
    render: (value: number) => <strong>{formatCurrency(value)}</strong>,
  },
  {
    title: 'Transactions',
    dataIndex: 'transactions',
    key: 'transactions',
  },
]

const feeColumns = [
  {
    title: 'When',
    dataIndex: 'transactedAt',
    key: 'transactedAt',
    render: (value: string) => formatTimestamp(value),
  },
  {
    title: 'Description',
    dataIndex: 'descriptionCluster',
    key: 'descriptionCluster',
  },
  {
    title: 'Amount',
    dataIndex: 'amount',
    key: 'amount',
    render: (value: number) => renderFlowTag(value, false),
  },
  {
    title: 'Channel',
    dataIndex: 'channel',
    key: 'channel',
    render: (value: string | null) => value ?? '—',
  },
]

const transactionColumns = [
  {
    title: 'Timestamp',
    dataIndex: 'transactedAt',
    key: 'transactedAt',
    width: 190,
    render: (value: string) => formatTimestamp(value),
  },
  {
    title: 'Description',
    dataIndex: 'description',
    key: 'description',
    width: 360,
    render: (_value: string, row: StatementTransaction) => (
      <div>
        <strong>{row.descriptionCluster}</strong>
        <div className="cell-secondary">{row.description}</div>
      </div>
    ),
  },
  {
    title: 'Recipient',
    dataIndex: 'recipientName',
    key: 'recipientName',
    width: 220,
    render: (_value: string | null, row: StatementTransaction) =>
      row.recipientName ? (
        <div>
          <strong>{row.recipientName}</strong>
          <div className="cell-secondary">
            {[row.counterpartyBank, row.recipientAccountNumber].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      ) : (
        '—'
      ),
  },
  {
    title: 'Direction',
    dataIndex: 'direction',
    key: 'direction',
    render: (value: StatementTransaction['direction']) => (
      <Tag color={value === 'outbound' ? 'volcano' : 'green'}>{value}</Tag>
    ),
  },
  {
    title: 'Amount',
    dataIndex: 'amount',
    key: 'amount',
    render: (value: number, row: StatementTransaction) =>
      renderFlowTag(value, row.direction === 'inbound'),
  },
  {
    title: 'Balance after',
    dataIndex: 'balanceAfter',
    key: 'balanceAfter',
    render: (value: number | null) => (value !== null ? formatCurrency(value) : '—'),
  },
  {
    title: 'Channel',
    dataIndex: 'channel',
    key: 'channel',
    render: (value: string | null) => value ?? '—',
  },
]

export default App
