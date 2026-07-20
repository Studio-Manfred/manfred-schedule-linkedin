import { useId, useRef, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { MAX_IMAGES, type PostImage } from '@/lib/types'

interface Props {
  images: PostImage[]
  onChange: (images: PostImage[]) => void
}

export function ImageAttach({ images, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const atCapacity = images.length >= MAX_IMAGES

  async function pick(files: FileList | null) {
    if (!files) return
    setUploading(true)
    setError(null)
    try {
      const uploaded: PostImage[] = []
      for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
        uploaded.push({ url: await api.uploadImage(file), alt: '' })
      }
      onChange([...images, ...uploaded])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">
        Images ({images.length}/{MAX_IMAGES})
      </legend>

      {/* Native input is driven by the button below so we control the label
          language and don't surface the browser's locale-specific file text. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => pick(e.target.files)}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={uploading || atCapacity}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Add images'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {images.map((img, i) => (
          <li key={img.url} className="flex items-start gap-3">
            <img src={img.url} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
            <div className="flex grow flex-col gap-1">
              <label htmlFor={`${fieldId}-alt-${i}`}>Add a description to the image</label>
              <div className="flex items-center gap-3">
                <input
                  id={`${fieldId}-alt-${i}`}
                  type="text"
                  value={img.alt}
                  required
                  onChange={(e) =>
                    onChange(images.map((m, j) => (j === i ? { ...m, alt: e.target.value } : m)))
                  }
                  className="grow rounded-md border border-input bg-background px-3 py-2"
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => onChange(images.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
