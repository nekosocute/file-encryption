<script setup lang="ts">
import { reactive, ref } from 'vue'
import { z } from 'zod'
import { EStep } from './enum/step.enum'
import { EError } from './enum/error.enum'
import { IResponse, IResponseProcessing } from './interface/response.interface'
import { IProgress } from './interface/progress.interface'
import { TActionType } from './interface/action.interface'
import { IResult } from './interface/result.interface'

const validator = z.object({
  path: z.string().min(1),
  secret: z.string().min(1),
  bit: z.coerce
    .number()
    .min(1)
    .max(4 ** 4)
})
const payload = reactive({
  path: '',
  secret: '',
  bit: '16'
})
const translateMessage = reactive({
  path: 'File path',
  secret: 'Secret key',
  bit: 'Key bit'
})
const action = ref<TActionType>('encrypt')
const result = ref<IResult | null>(null)
const isLoading = ref(false)

const progress = reactive<Record<TActionType, IProgress>>({
  encrypt: {
    uuid: '',
    step: EStep.FILE,
    process: {
      [EStep.FILE]: {
        current: 0,
        total: 0
      },
      [EStep.ZIP]: {
        current: 0,
        total: 0
      },
      [EStep.AES]: {
        current: 0,
        total: 0
      },
      [EStep.XOR]: {
        current: 0,
        total: 0
      }
    }
  },
  decrypt: {
    uuid: '',
    step: EStep.FILE,
    process: {
      [EStep.FILE]: {
        current: 0,
        total: 0
      },
      [EStep.ZIP]: {
        current: 0,
        total: 0
      },
      [EStep.AES]: {
        current: 0,
        total: 0
      },
      [EStep.XOR]: {
        current: 0,
        total: 0
      }
    }
  }
})

function caculateTime() {
  let total = 0
  if (result.value) {
    for (const [, val] of Object.entries(result.value.data.debug)) {
      total += val.end - val.start
    }
  }

  return total
}

// ===== Start encrypt ===== //
window.electron.ipcRenderer.on(
  'encrypt.process',
  (_, step: EStep, data: IResponse<IResponseProcessing>) => {
    progress.encrypt.step = step
    progress.encrypt.process[step].total = data.data.total
    progress.encrypt.process[step].current = data.data.current
  }
)
window.electron.ipcRenderer.on('encrypt.error', (_, step: EError, data: IResponse<null>) => {
  // console.log(step, data)
  alert(`Error when encryption [${EError[step]}]: ${data.message} `)
  // Reset data
  progress.encrypt.uuid = ''
  isLoading.value = false
})

// ===== Start decrypt ===== //
window.electron.ipcRenderer.on(
  'decrypt.process',
  (_, step: EStep, data: IResponse<IResponseProcessing>) => {
    progress.decrypt.step = step
    progress.decrypt.process[step].total = data.data.total
    progress.decrypt.process[step].current = data.data.current
    isLoading.value = false
  }
)
window.electron.ipcRenderer.on('decrypt.error', (_, step: EError, data: IResponse<null>) => {
  alert(`Error when decryption [${EError[step]}]: ${data.message} `)
  // Reset data
  progress.decrypt.uuid = ''
  isLoading.value = false
})

// ==== Global ==== //
window.electron.ipcRenderer.on('global.finish', (_, data: IResult) => {
  // Clear progress
  progress.encrypt.uuid = ''
  // Show result
  result.value = data
  // Reset data
  isLoading.value = false
})

async function doProceed() {
  const { error, success, data } = await validator.safeParseAsync(payload)
  if (success) {
    result.value = null
    isLoading.value = true
    progress.encrypt.uuid = await window.electron.ipcRenderer.invoke(action.value, data)
  } else if (error) {
    // Get first error
    const err = error.issues[0]
    const notionPath = err.path.join('.')
    alert(`${err.code}: ${translateMessage[notionPath] || notionPath} ${err.message}`)
  }
}

function fileUpload(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files && files.length > 0) {
    // Get first data
    const file = files[0]
    payload.path = file.path
  }
}
</script>

<template>
  <div class="flex justify-center items-center h-screen">
    <div
      class="flex flex-col border shadow-sm rounded-xl p-4 md:p-5 bg-neutral-900 border-neutral-700 text-neutral-400"
    >
      <div class="border-b border-neutral-700">
        <nav class="flex gap-x-1">
          <button
            type="button"
            class="py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-sm whitespace-nowrap focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none text-neutral-400 hover:text-blue-500"
            :class="{
              '!font-semibold !border-blue-600 !text-blue-600': action === 'encrypt'
            }"
            @click="action = 'encrypt'"
          >
            Encrypt
          </button>
          <button
            type="button"
            class="py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-sm whitespace-nowrap focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none text-neutral-400 hover:text-blue-500"
            :class="{
              '!font-semibold !border-blue-600 !text-blue-600': action === 'decrypt'
            }"
            @click="action = 'decrypt'"
          >
            Decrypt
          </button>
        </nav>
      </div>

      <div class="mt-3">
        <div id="encrypt-tab" role="tabpanel" class="space-y-3">
          <!-- File upload -->
          <div>
            <h4 class="text-lg font-semibold">Step1: Choose file</h4>
            <div class="max-w-sm">
              <label for="file-input" class="sr-only">Choose file</label>
              <input
                id="file-input"
                type="file"
                name="file-input"
                class="block w-full border border-gray-200 shadow-sm rounded-lg text-sm focus:z-10 focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-400 file:bg-gray-50 file:border-0 file:me-4 file:py-3 file:px-4 dark:file:bg-neutral-700 dark:file:text-neutral-400"
                @change="fileUpload"
              />
            </div>
          </div>
          <hr class="border-neutral-700" />
          <div>
            <h4 class="text-lg font-semibold">Step2: Enter configure</h4>
            <div class="mt-2 space-y-2">
              <!-- Secret key -->
              <div class="max-w-sm">
                <label for="secretkey" class="block text-sm font-medium mb-2 dark:text-white"
                  >Secret key</label
                >
                <input
                  id="secretkey"
                  v-model="payload.secret"
                  type="password"
                  class="py-3 px-4 block w-full border-gray-200 rounded-lg text-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-400 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                  placeholder="*************"
                />
              </div>
              <!-- Key bit -->
              <div class="max-w-sm">
                <label for="secretkey" class="block text-sm font-medium mb-2 dark:text-white"
                  >Key bit</label
                >
                <div>
                  <input
                    v-model="payload.bit"
                    type="text"
                    class="py-3 px-4 block w-full border-gray-200 rounded-lg text-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-400 dark:placeholder-neutral-500 dark:focus:ring-neutral-600"
                    placeholder="16"
                  />
                </div>
              </div>
            </div>
          </div>
          <!-- Progress -->
          <div
            v-if="progress.encrypt.uuid !== ''"
            class="flex items-center gap-x-3 whitespace-nowrap"
          >
            <h4>{{ EStep[progress.encrypt.step] }}</h4>
            <div
              class="flex w-full h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-neutral-700"
              role="progressbar"
              aria-valuenow="25"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="flex flex-col justify-center rounded-full overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-blue-500"
                :style="{
                  width: `${(progress.encrypt.process[progress.encrypt.step].current / progress.encrypt.process[progress.encrypt.step].total) * 100}%`
                }"
              />
            </div>
            <div class="w-10 text-end">
              <span class="text-sm text-gray-800 dark:text-white">
                <div v-if="progress.encrypt.process[progress.encrypt.step].total !== -1">
                  {{
                    `${Math.floor(
                      (progress.encrypt.process[progress.encrypt.step].current /
                        progress.encrypt.process[progress.encrypt.step].total) *
                        100
                    )}%`
                  }}
                </div>
                <div v-else>
                  <span
                    class="animate-spin inline-block size-4 border-[3px] border-current border-t-transparent text-white rounded-full"
                    role="status"
                    aria-label="loading"
                  />
                </div>
              </span>
            </div>
          </div>
          <!-- Success -->
          <div
            v-if="result"
            class="bg-teal-50 border-t-2 border-teal-500 rounded-lg p-4 dark:bg-teal-800/30 max-w-sm"
          >
            <div class="flex">
              <div class="shrink-0">
                <!-- Icon -->
                <span
                  class="inline-flex justify-center items-center size-8 rounded-full border-4 border-teal-100 bg-teal-200 text-teal-800 dark:border-teal-900 dark:bg-teal-800 dark:text-teal-400"
                >
                  <svg
                    class="shrink-0 size-4"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
                    ></path>
                    <path d="m9 12 2 2 4-4"></path>
                  </svg>
                </span>
                <!-- End Icon -->
              </div>
              <div class="ms-3">
                <h3
                  id="hs-bordered-success-style-label"
                  class="text-gray-800 font-semibold dark:text-white"
                >
                  {{ action === 'encrypt' ? 'Encrypt' : 'Decrypt' }} success!
                </h3>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Load file:
                  {{
                    Math.floor(
                      (result.data.debug[EStep.FILE].end - result.data.debug[EStep.FILE].start) *
                        100
                    ) / 100
                  }}ms
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  {{ action === 'encrypt' ? 'Compress' : 'Decompress' }} file:
                  {{
                    Math.floor(
                      (result.data.debug[EStep.ZIP].end - result.data.debug[EStep.ZIP].start) * 100
                    ) / 100
                  }}ms
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Checksum:
                  {{
                    Math.floor(
                      (result.data.debug[EStep.CHECKSUM].end -
                        result.data.debug[EStep.CHECKSUM].start) *
                        100
                    ) / 100
                  }}ms
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  AES ({{ action === 'encrypt' ? 'Encrypt' : 'Decrypt' }}):
                  {{
                    Math.floor(
                      (result.data.debug[EStep.AES].end - result.data.debug[EStep.AES].start) * 100
                    ) / 100
                  }}ms
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  XOR:
                  {{
                    Math.floor(
                      (result.data.debug[EStep.XOR].end - result.data.debug[EStep.XOR].start) * 100
                    ) / 100
                  }}ms
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Total:
                  {{ Math.floor(caculateTime() * 100) / 100 }}ms
                </p>
                <hr class="my-3 border-slate-700" />
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Size (Before):
                  {{ Math.floor((result.data.size.before / 1024 / 1024) * 100) / 100 }}MB
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Size (After):
                  {{ Math.floor((result.data.size.after / 1024 / 1024) * 100) / 100 }}MB
                </p>
                <p class="text-sm text-gray-700 dark:text-neutral-400">
                  Diff:
                  {{
                    Math.floor(
                      ((result.data.size.before - result.data.size.after) / 1024 / 1024) * 100
                    ) / 100
                  }}MB
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            :disabled="isLoading"
            class="w-full flex justify-center py-3 px-4 items-center gap-x-2 text-sm font-medium rounded-lg border border-transparent bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
            @click="doProceed"
          >
            <span
              v-if="isLoading"
              class="animate-spin inline-block size-4 border-[3px] border-current border-t-transparent text-white rounded-full"
              role="status"
              aria-label="loading"
            ></span>
            {{ !isLoading ? `${action === 'encrypt' ? 'Encrypt' : 'Decrypt'} it!` : 'Loading...' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
