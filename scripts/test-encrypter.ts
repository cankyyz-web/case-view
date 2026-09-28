import { openShare, PBKDF2_ITERATIONS, randomPin, sealShare, type SharePayload } from '../supabase/functions/_shared/encrypter.ts'

const payload: SharePayload = {
  v: 1,
  title: 'Case',
  files: [{ name: 'Upper jaw', url: 'https://example.supabase.co/storage/v1/object/sign/cases/demo/Upper_Jaw.stl?token=abc' }],
}

if (PBKDF2_ITERATIONS !== 50_000) throw new Error('iterations')

const pins = new Set<string>()
for (let i = 0; i < 30; i += 1) {
  const pin = randomPin()
  if (!/^\d{4}$/.test(pin)) throw new Error(`bad pin ${pin}`)
  pins.add(pin)
}
if (pins.size < 2) throw new Error('pin not random')

const pin = '0481'
const sealed = await sealShare(pin, payload)
const again = await sealShare(pin, payload)
if (sealed.salt === again.salt || sealed.ciphertext === again.ciphertext) {
  throw new Error('seal reused salt')
}

const opened = await openShare(pin, sealed)
if (!opened || opened.files[0].url !== payload.files[0].url) throw new Error('roundtrip')

const wrong = await openShare('0482', sealed)
if (wrong !== null) throw new Error('wrong pin opened')

const tampered = { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}aa` }
const broken = await openShare(pin, tampered)
if (broken !== null) throw new Error('tamper opened')

const padded = await openShare('0007', await sealShare('0007', payload))
if (!padded) throw new Error('leading zero pin')

console.log(`ok iterations=${PBKDF2_ITERATIONS} samplePins=${pins.size}`)
