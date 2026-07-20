import { useRef, useState } from 'react'
import { Button } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { MAX_IMAGES, type PostImage } from '@/lib/types'

interface Props {
  images: PostImage[]
  onChange: (images: PostImage[]) => void
}

export function ImageAttach({ images, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <legend className="font-medium">Images ({images.length}/{MAX_IMAGES})</legend>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        aria-label="Attach images"
        onChange={(e) => pick(e.target.files)}
        disabled={uploading || images.length >= MAX_IMAGES}
      />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <ul className="flex flex-col gap-3">
        {images.map((img, i) => (
          <li key={img.url} className="flex items-start gap-3">
            <img src={img.url} alt="" className="h-16 w-16 rounded object-cover" />
            <label className="flex grow flex-col gap-1">
              <span>Alt text (describe the image)</span>
              <input
                type="text"
                value={img.alt}
                required
                onChange={(e) =>
                  onChange(images.map((m, j) => (j === i ? { ...m, alt: e.target.value } : m)))
                }
                className="rounded-md border border-input bg-background px-3 py-2"
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove image ${i + 1}`}
              onClick={() => onChange(images.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
