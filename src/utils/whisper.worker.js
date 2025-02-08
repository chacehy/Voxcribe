import { pipeline } from '@xenova/transformers'
import { MessageTypes } from './presets'

/**
 * Singleton class for managing the Whisper transcription pipeline
 * Ensures only one instance of the pipeline is created and reused
 */
class MyTranscriptionPipeline {
    /**
     * Task type for the transcription pipeline
     * @type {string}
     */
    static task = 'automatic-speech-recognition'

    /**
     * Model name for the transcription pipeline
     * @type {string}
     */
    static model = 'openai/whisper-tiny.en'

    /**
     * Singleton instance of the transcription pipeline
     * @type {Pipeline|null}
     */
    static instance = null

    /**
     * Gets or creates a singleton instance of the transcription pipeline
     * @param {Function|null} progress_callback - Optional callback for tracking model loading progress
     * @returns {Promise<Pipeline>} The transcription pipeline instance
     */
    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, null, { progress_callback })
        }

        return this.instance
    }
}

// Set up worker message handler
/**
 * Handles incoming messages from the main thread
 * @param {MessageEvent} event - The incoming message event
 */
self.addEventListener('message', async (event) => {
    const { type, audio } = event.data
    if (type === MessageTypes.INFERENCE_REQUEST) {
        await transcribe(audio)
    }
})

/**
 * Main transcription function that processes audio input
 * @param {Float32Array} audio - The audio data to transcribe
 * @returns {Promise<void>}
 */
async function transcribe(audio) {
    sendLoadingMessage('loading')

    let pipeline

    try {
        pipeline = await MyTranscriptionPipeline.getInstance(load_model_callback)
    } catch (err) {
        console.log(err.message)
    }

    sendLoadingMessage('success')

    const stride_length_s = 5

    const generationTracker = new GenerationTracker(pipeline, stride_length_s)
    await pipeline(audio, {
        top_k: 0,
        do_sample: false,
        chunk_length: 30,
        stride_length_s,
        return_timestamps: true,
        callback_function: generationTracker.callbackFunction.bind(generationTracker),
        chunk_callback: generationTracker.chunkCallback.bind(generationTracker)
    })
    generationTracker.sendFinalResult()
}

/**
 * Callback function for tracking model loading progress
 * @param {Object} data - Progress data from the pipeline
 * @param {string} data.status - Current status of the loading process
 * @param {string} [data.file] - File being downloaded
 * @param {number} [data.progress] - Download progress percentage
 * @param {number} [data.loaded] - Bytes loaded
 * @param {number} [data.total] - Total bytes to load
 */
async function load_model_callback(data) {
    const { status } = data
    if (status === 'progress') {
        const { file, progress, loaded, total } = data
        sendDownloadingMessage(file, progress, loaded, total)
    }
}

/**
 * Sends a loading status message to the main thread
 * @param {string} status - The loading status to report
 */
function sendLoadingMessage(status) {
    self.postMessage({
        type: MessageTypes.LOADING,
        status
    })
}

/**
 * Sends a downloading progress message to the main thread
 * @param {string} file - The file being downloaded
 * @param {number} progress - Download progress percentage
 * @param {number} loaded - Bytes loaded
 * @param {number} total - Total bytes to download
 */
async function sendDownloadingMessage(file, progress, loaded, total) {
    self.postMessage({
        type: MessageTypes.DOWNLOADING,
        file,
        progress,
        loaded,
        total
    })
}

/**
 * Class for tracking and managing the generation of transcription results
 * Handles chunking, processing, and result aggregation
 */
class GenerationTracker {
    /**
     * @param {Pipeline} pipeline - The transcription pipeline instance
     * @param {number} stride_length_s - The stride length in seconds
     */
    constructor(pipeline, stride_length_s) {
        /**
         * The transcription pipeline instance
         * @type {Pipeline}
         */
        this.pipeline = pipeline

        /**
         * The stride length in seconds
         * @type {number}
         */
        this.stride_length_s = stride_length_s

        /**
         * Array of chunked audio data
         * @type {Array}
         */
        this.chunks = []

        /**
         * Time precision for timestamp calculations
         * @type {number}
         */
        this.time_precision = pipeline?.processor.feature_extractor.config.chunk_length / pipeline.model.config.max_source_positions

        /**
         * Array of processed chunks
         * @type {Array}
         */
        this.processed_chunks = []

        /**
         * Counter for callback function calls
         * @type {number}
         */
        this.callbackFunctionCounter = 0
    }

    /**
     * Sends the final transcription result to the main thread
     */
    sendFinalResult() {
        self.postMessage({ type: MessageTypes.INFERENCE_DONE })
    }

    /**
     * Processes intermediate beam results during transcription
     * @param {Array} beams - Array of beam search results
     */
    callbackFunction(beams) {
        this.callbackFunctionCounter += 1
        if (this.callbackFunctionCounter % 10 !== 0) {
            return
        }

        const bestBeam = beams[0]
        let text = this.pipeline.tokenizer.decode(bestBeam.output_token_ids, {
            skip_special_tokens: true
        })

        const result = {
            text,
            start: this.getLastChunkTimestamp(),
            end: undefined
        }

        createPartialResultMessage(result)
    }

    /**
     * Processes a chunk of audio data
     * @param {Object} data - Chunk data from the pipeline
     */
    chunkCallback(data) {
        this.chunks.push(data)
        const [text, { chunks }] = this.pipeline.tokenizer._decode_asr(
            this.chunks,
            {
                time_precision: this.time_precision,
                return_timestamps: true,
                force_full_sequence: false
            }
        )

        this.processed_chunks = chunks.map((chunk, index) => {
            return this.processChunk(chunk, index)
        })

        createResultMessage(
            this.processed_chunks, false, this.getLastChunkTimestamp()
        )
    }

    /**
     * Gets the timestamp of the last chunk
     * @returns {number} The timestamp of the last chunk
     */
    getLastChunkTimestamp() {
        if (this.processed_chunks.length === 0) {
            return 0
        }
    }

    /**
     * Processes a single chunk of audio data
     * @param {Object} chunk - The chunk data to process
     * @param {number} index - The index of the chunk
     * @returns {Object} The processed chunk data
     */
    processChunk(chunk, index) {
        const { text, timestamp } = chunk
        const [start, end] = timestamp

        return {
            index,
            text: `${text.trim()}`,
            start: Math.round(start),
            end: Math.round(end) || Math.round(start + 0.9 * this.stride_length_s)
        }
    }
}

/**
 * Creates a message containing transcription results
 * @param {Array} results - Array of transcription results
 * @param {boolean} isDone - Whether transcription is complete
 * @param {number} completedUntilTimestamp - Timestamp of last completed chunk
 * @returns {Object} Message object with results
 */
function createResultMessage(results, isDone, completedUntilTimestamp) {
    self.postMessage({
        type: MessageTypes.RESULT,
        results,
        isDone,
        completedUntilTimestamp
    })
}

/**
 * Creates a message for partial transcription results
 * @param {Object} result - The partial transcription result
 * @returns {Object} Message object with partial result
 */
function createPartialResultMessage(result) {
    self.postMessage({
        type: MessageTypes.RESULT_PARTIAL,
        result
    })
}
