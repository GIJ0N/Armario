import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PasteCutoutButton } from '../src/components/PasteCutoutButton'
import { ToastProvider } from '../src/components/ToastProvider'
import {
  NO_CLIPBOARD_IMAGE_MESSAGE,
  clipboardReadSupported,
  imageFromPasteEvent,
  readClipboardImage,
  type ClipboardItemLike,
} from '../src/lib/clipboardImage'

const item = (types: string[], blob = new Blob(['png-bytes'], { type: 'image/png' })): ClipboardItemLike => ({
  types,
  getType: vi.fn(async () => blob),
})

afterEach(() => vi.unstubAllGlobals())

describe('readClipboardImage', () => {
  it('elige la primera imagen y prefiere image/png', async () => {
    const it1 = item(['text/plain'])
    const it2 = item(['image/jpeg', 'image/png'])
    const res = await readClipboardImage(async () => [it1, it2])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.file.type).toBe('image/png')
      expect(res.file.name).toBe('portapapeles.png')
    }
    expect(it2.getType).toHaveBeenCalledWith('image/png')
    expect(it1.getType).not.toHaveBeenCalled()
  })

  it('portapapeles vacío, sin imagen o con blob vacío → empty', async () => {
    expect(await readClipboardImage(async () => [])).toEqual({ ok: false, reason: 'empty' })
    expect(await readClipboardImage(async () => [item(['text/plain'])])).toEqual({ ok: false, reason: 'empty' })
    expect(await readClipboardImage(async () => [item(['image/png'], new Blob([], { type: 'image/png' }))])).toEqual({
      ok: false,
      reason: 'empty',
    })
  })

  it('NotAllowedError → denied; otro error → error; nunca lanza', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    expect(await readClipboardImage(async () => Promise.reject(denied))).toEqual({ ok: false, reason: 'denied' })
    expect(await readClipboardImage(async () => Promise.reject(new Error('x')))).toEqual({ ok: false, reason: 'error' })
  })

  it('detecta si la API existe', () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    expect(clipboardReadSupported()).toBe(false)
    vi.stubGlobal('navigator', { clipboard: { read: async () => [] } })
    expect(clipboardReadSupported()).toBe(true)
  })

  it('imageFromPasteEvent lee files e items', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    expect(imageFromPasteEvent({ clipboardData: { files: [f], items: [] } as unknown as DataTransfer })).toBe(f)
    const viaItem = { kind: 'file', type: 'image/webp', getAsFile: () => f }
    expect(imageFromPasteEvent({ clipboardData: { files: [], items: [viaItem] } as unknown as DataTransfer })).toBe(f)
    expect(imageFromPasteEvent({ clipboardData: { files: [], items: [] } as unknown as DataTransfer })).toBeNull()
    expect(imageFromPasteEvent({ clipboardData: null })).toBeNull()
  })
})

function renderButton(props: Partial<Parameters<typeof PasteCutoutButton>[0]> = {}) {
  const onFile = vi.fn()
  render(
    <ToastProvider>
      <PasteCutoutButton onFile={onFile} {...props} />
    </ToastProvider>,
  )
  return onFile
}

describe('PasteCutoutButton', () => {
  it('éxito: entrega el PNG pegado', async () => {
    const reader = vi.fn(async () => [item(['image/png'])])
    const onFile = renderButton({ reader })
    await userEvent.click(screen.getByRole('button', { name: 'Pegar foto' }))
    await waitFor(() => expect(onFile).toHaveBeenCalledOnce())
    expect(onFile.mock.calls[0][0]).toBeInstanceOf(File)
    expect(onFile.mock.calls[0][0].type).toBe('image/png')
  })

  it('el lector se llama dentro del clic (síncrono, para el gesto del usuario)', () => {
    const reader = vi.fn(async () => [])
    renderButton({ reader })
    fireEvent.click(screen.getByRole('button', { name: 'Pegar foto' }))
    expect(reader).toHaveBeenCalledTimes(1)
  })

  it('portapapeles vacío o permiso denegado → aviso y sin imagen', async () => {
    const onFile = renderButton({ reader: async () => [] })
    await userEvent.click(screen.getByRole('button', { name: 'Pegar foto' }))
    expect(await screen.findByText(NO_CLIPBOARD_IMAGE_MESSAGE)).toBeInTheDocument()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('permiso denegado muestra el mismo aviso', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    renderButton({ reader: async () => Promise.reject(denied) })
    await userEvent.click(screen.getByRole('button', { name: 'Pegar foto' }))
    expect(await screen.findByText(NO_CLIPBOARD_IMAGE_MESSAGE)).toBeInTheDocument()
  })

  it('sin la API: oculta el botón y ofrece un destino de pegado que atiende el evento paste', () => {
    const onFile = renderButton()
    expect(screen.queryByRole('button', { name: 'Pegar foto' })).not.toBeInTheDocument()
    const target = screen.getByTestId('paste-target')
    expect(target).toHaveAttribute('tabindex', '0')
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.paste(target, { clipboardData: { files: [f], items: [] } })
    expect(onFile).toHaveBeenCalledWith(f)
  })

  it('el destino de pegado sin imagen muestra el aviso', async () => {
    const onFile = renderButton()
    fireEvent.paste(screen.getByTestId('paste-target'), { clipboardData: { files: [], items: [] } })
    expect(await screen.findByText(NO_CLIPBOARD_IMAGE_MESSAGE)).toBeInTheDocument()
    expect(onFile).not.toHaveBeenCalled()
  })
})
