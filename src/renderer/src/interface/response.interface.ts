interface IResponseBase {
  uuid: string
}

export interface IResponseProcessing {
  current: number
  total: number
}

export interface IResponseCompleted {
  content: Buffer
}

export type IResponse<D> = IResponseBase & {
  message: string | null
  data: D
}
