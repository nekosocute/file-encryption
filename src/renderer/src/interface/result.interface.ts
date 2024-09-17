import { EStep } from '../enum/step.enum'

export interface IResult {
  uuid: string
  message: null
  data: {
    path: string
    size: {
      before: number
      after: number
    }
    debug: Record<
      EStep,
      {
        start: number
        end: number
      }
    >
  }
}
