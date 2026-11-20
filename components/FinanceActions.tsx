import { ActionForm, SubmitButton } from './forms'
import { payClaim, returnClaim } from '@/app/actions'

export function FinanceActions({ id, today }: { id: string; today: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ActionForm action={payClaim}>
        <input type="hidden" name="id" value={id} />
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Payment ref</span>
            <input name="payment_ref" defaultValue={`PAYROLL-${today.slice(0, 7)}`} className="input" />
          </label>
          <label>
            <span className="label">Paid on</span>
            <input type="date" name="paid_on" defaultValue={today} className="input" />
          </label>
        </div>
        <SubmitButton className="btn-success btn-sm" pendingText="Saving…">Mark paid</SubmitButton>
      </ActionForm>
      <ActionForm action={returnClaim}>
        <input type="hidden" name="id" value={id} />
        <label className="block">
          <span className="label">Return to employee</span>
          <input name="remark" className="input" placeholder="e.g. Receipt INV-55120 is unreadable" />
        </label>
        <SubmitButton className="btn-danger btn-sm" pendingText="Returning…">Return</SubmitButton>
      </ActionForm>
    </div>
  )
}
