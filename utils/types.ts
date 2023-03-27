export interface Claim {
    id: number,
    provider: string,
    redactedParameters: string,
    ownerPublicKey: string,
    timestampS: string,
    witnessAddresses: string[],
    signatures: string[],
    parameters: {
        [key: string]: string
    }
}