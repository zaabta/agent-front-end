import {describe,expect,it} from 'vitest'
import {render,screen} from '@testing-library/react'
import {AgentCitations} from './AgentCitations'

describe('agent citation rendering',()=>{
 it('shows only returned Markdown and Word source metadata',()=>{render(<AgentCitations citations={[{source:'guide.md',sourceRef:'ref-md',chunkIndex:0,location:'Heading: Setup'},{source:'report.docx',sourceRef:'ref-docx',documentVersionId:'version-4',chunkIndex:3,paragraphStart:7,paragraphEnd:8}]}/>);expect(screen.getByText('guide.md')).toBeInTheDocument();expect(screen.getByText('MD · Passage 1 · Heading: Setup · ref-md')).toBeInTheDocument();expect(screen.getByText('report.docx')).toBeInTheDocument();expect(screen.getByText('DOCX · Passage 4 · Paragraph 7–8 · Version version-4 · ref-docx')).toBeInTheDocument()})
 it('renders no citation panel when the backend provides no sources',()=>{const{container}=render(<AgentCitations citations={[]}/>);expect(container.firstChild).toBeNull()})
})
