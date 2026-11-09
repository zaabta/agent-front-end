import { describe, expect, it } from 'vitest'
import { apiUrl } from '../../api/client'
describe('Vite local proxy URLs',()=>{it('uses same-origin API paths when no production URL is configured',()=>{expect(apiUrl('/api/jobs/test/events')).toBe('/api/jobs/test/events')})})
