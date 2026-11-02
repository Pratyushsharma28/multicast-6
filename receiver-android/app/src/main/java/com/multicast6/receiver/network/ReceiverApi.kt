package com.multicast6.receiver.network

/**
 * Reserved boundary for a future authenticated connection to MultiCast 6.
 * This scaffold deliberately has no transport, routes, credentials, or command handlers.
 */
interface ReceiverApi {
    suspend fun beginPairing(pairingCode: String): PairingResult
    suspend fun sendMediaCommand(command: MediaCommand): CommandResult
}

sealed interface PairingResult {
    data object NotImplemented : PairingResult
}

sealed interface CommandResult {
    data object NotImplemented : CommandResult
}

/** Commands are data types only; no unauthenticated endpoint accepts them. */
sealed interface MediaCommand {
    data object Play : MediaCommand
    data object Pause : MediaCommand
    data object Stop : MediaCommand
}
