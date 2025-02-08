import React from 'react'

/**
 * Transcription Component
 * 
 * Displays the transcribed text content.
 * A simple component that renders the transcription results.
 * 
 * @component
 * @param {Object} props
 * @param {string|Array<string>} props.textElement - The transcribed text to display
 * @returns {JSX.Element} Container with transcribed text
 */
export default function Transcription(props) {
    const { textElement } = props

    return (
        <div>{textElement}</div>
    )
}
