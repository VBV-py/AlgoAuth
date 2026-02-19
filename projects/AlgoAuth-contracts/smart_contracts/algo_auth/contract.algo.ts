import { Contract } from '@algorandfoundation/algorand-typescript'

export class AlgoAuth extends Contract {
  hello(name: string): string {
    return `Hello, ${name}`
  }
}
