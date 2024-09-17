import { EStep } from '@renderer/enum/step.enum'
import { IResponseProcessing } from './response.interface'

export interface IProgress {
  uuid: string
  step: EStep
  process: Record<Exclude<EStep, EStep.CHECKSUM>, IResponseProcessing>
}
