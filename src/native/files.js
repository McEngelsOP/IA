import { isAndroid } from './android.js'
export async function prepareDownload(blob, filename, { keepAvailable = false } = {}) {
  if (isAndroid()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
    const path = 'exports/' + filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const file = await Filesystem.writeFile({ path, directory: Directory.Cache, data: btoa(binary), recursive: true })
    const share = async () => {
      try { await Share.share({ title: filename, files: [file.uri], dialogTitle: 'Guardar o compartir archivo' }) }
      catch (error) { if (!/cancel/i.test(String(error?.message))) throw error }
    }
    return { filename, url: null, share, dispose() {} }
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; URL.revokeObjectURL(url) } }
  if (!keepAvailable) setTimeout(dispose, 60000)
  return { url, filename, dispose }
}
