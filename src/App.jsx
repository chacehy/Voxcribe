import { useState, useRef, useEffect } from 'react'
import HomePage from './components/HomePage'
import Header from './components/Header'
import FileDisplay from './components/FileDisplay'
import Information from './components/Information'
import Transcribing from './components/Transcribing'
import { MessageTypes } from './utils/presets'

/**
 * App Component - Main application component for Voxcribe
 * 
 * This component manages the main application state and orchestrates the audio transcription workflow.
 * It handles file uploads, audio streaming, worker communication, and renders different views based on
 * the current application state.
 * 
 * @component
 * @returns {JSX.Element} The main application layout
 */
function App() {
  /**
   * State variable to store the uploaded file
   * @type {File|null}
   */
  const [file, setFile] = useState(null)

  /**
   * State variable to store the audio stream
   * @type {Blob|null}
   */
  const [audioStream, setAudioStream] = useState(null)

  /**
   * State variable to store the transcription output
   * @type {Object|null}
   */
  const [output, setOutput] = useState(null)

  /**
   * State variable to track the download status
   * @type {Boolean}
   */
  const [downloading, setDownloading] = useState(false)

  /**
   * State variable to track the loading status
   * @type {Boolean}
   */
  const [loading, setLoading] = useState(false)

  /**
   * State variable to track the completion status
   * @type {Boolean}
   */
  const [finished, setFinished] = useState(false)

  /**
   * Checks if audio is available (either file or stream)
   * @type {Boolean}
   */
  const isAudioAvailable = file || audioStream

  /**
   * Resets the audio state by clearing both file and stream
   */
  function handleAudioReset() {
    setFile(null)
    setAudioStream(null)
  }

  /**
   * Reference to the Web Worker instance
   * @type {Worker|null}
   */
  const worker = useRef(null)

  /**
   * Sets up and manages the Web Worker for audio transcription
   * Handles various message types from the worker including download status,
   * loading state, transcription results, and completion status
   */
  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL('./utils/whisper.worker.js', import.meta.url), {
        type: 'module'
      })
    }

    /**
     * Event handler for messages received from the Web Worker
     * @param {MessageEvent} e - The message event
     */
    const onMessageReceived = async (e) => {
      switch (e.data.type) {
        case 'DOWNLOADING':
          setDownloading(true)
          console.log('DOWNLOADING')
          break;
        case 'LOADING':
          setLoading(true)
          console.log('LOADING')
          break;
        case 'RESULT':
          setOutput(e.data.results)
          console.log(e.data.results)
          break;
        case 'INFERENCE_DONE':
          setFinished(true)
          console.log("DONE")
          break;
      }
    }

    worker.current.addEventListener('message', onMessageReceived)

    return () => worker.current.removeEventListener('message', onMessageReceived)
  })

  /**
   * Converts an audio file or stream to the required format for processing
   * @param {File|Blob} file - The audio file or stream to process
   * @returns {Float32Array} Processed audio data at 16kHz sampling rate
   */
  async function readAudioFrom(file) {
    const sampling_rate = 16000
    const audioCTX = new AudioContext({ sampleRate: sampling_rate })
    const response = await file.arrayBuffer()
    const decoded = await audioCTX.decodeAudioData(response)
    const audio = decoded.getChannelData(0)
    return audio
  }

  /**
   * Handles the transcription process by preparing the audio data and
   * sending it to the Web Worker for processing
   * @returns {void}
   */
  async function handleFormSubmission() {
    if (!file && !audioStream) { return }

    let audio = await readAudioFrom(file ? file : audioStream)
    const model_name = `openai/whisper-tiny.en`

    worker.current.postMessage({
      type: MessageTypes.INFERENCE_REQUEST,
      audio,
      model_name
    })
  }

  return (
    <div className='flex flex-col max-w-[1000px] mx-auto w-full'>
      <section className='min-h-screen flex flex-col'>
        <Header />
        {output ? (
          <Information output={output} finished={finished}/>
        ) : loading ? (
          <Transcribing />
        ) : isAudioAvailable ? (
          <FileDisplay handleFormSubmission={handleFormSubmission} handleAudioReset={handleAudioReset} file={file} audioStream={audioStream} />
        ) : (
          <HomePage setFile={setFile} setAudioStream={setAudioStream} />
        )}
      </section>
    </div>
  )
}

export default App
