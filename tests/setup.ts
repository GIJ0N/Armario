import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// CI lento: findBy*/waitFor esperan hasta 5 s en lugar del 1 s por defecto.
configure({ asyncUtilTimeout: 5000 })
