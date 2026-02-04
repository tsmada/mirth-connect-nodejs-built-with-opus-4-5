# Scenario 3.3: File Reader to File Writer

## Purpose

Validates the File connector implementation:
- File Reader polls a directory for new files
- Channel processes file contents
- File Writer outputs to a different directory
- Tests file handling, naming, and error scenarios

## Flow Diagram

```
[Input Dir] --> [File Reader] --> [Channel] --> [File Writer] --> [Output Dir]
     |                                               |
     v                                               v
[Move/Delete]                                   [New File]
```

## Test Cases

### 3.3.1 Simple Text File
- Drop text file in input directory
- Verify output file created with same content
- Verify input file is processed (deleted/moved)

### 3.3.2 Binary File
- Drop binary file (e.g., PDF placeholder)
- Verify byte-for-byte output match

### 3.3.3 Multiple Files
- Drop multiple files simultaneously
- Verify processing order matches (by name or date)

### 3.3.4 Large File
- Drop file larger than memory buffer
- Verify streaming behavior works

### 3.3.5 File with Special Characters
- Drop file with unicode in filename
- Verify filename handling matches

## Input Files

- `inputs/test-document.txt` - Simple text document
- `inputs/multiple/file-001.txt` - First of multiple test files
- `inputs/multiple/file-002.txt` - Second of multiple test files
- `inputs/multiple/file-003.txt` - Third of multiple test files

## Directory Setup

Before running tests:
```bash
# Create test directories
mkdir -p /tmp/mirth-java-in /tmp/mirth-java-out
mkdir -p /tmp/mirth-node-in /tmp/mirth-node-out

# Set permissions
chmod 777 /tmp/mirth-*
```

## Channel Configuration

The channel should:
1. Poll input directory every 1 second
2. Filter for `*.txt` files
3. Sort by filename
4. After processing: delete source file
5. Write to output directory with pattern: `processed_${originalFilename}`

## File Reader Settings

```xml
<sourceConnectorProperties>
  <host>/tmp/mirth-java-in</host>  <!-- or /tmp/mirth-node-in -->
  <fileFilter>*.txt</fileFilter>
  <regex>false</regex>
  <pollingType>interval</pollingType>
  <pollingFrequency>1000</pollingFrequency>
  <processBatch>false</processBatch>
  <sortBy>name</sortBy>
  <afterProcessingAction>DELETE</afterProcessingAction>
</sourceConnectorProperties>
```

## File Writer Settings

```xml
<destinationConnectorProperties>
  <host>/tmp/mirth-java-out</host>  <!-- or /tmp/mirth-node-out -->
  <outputPattern>processed_${originalFilename}</outputPattern>
  <outputAppend>false</outputAppend>
  <createParentDirectories>true</createParentDirectories>
</destinationConnectorProperties>
```

## Validation

Compare between Java and Node.js:
- Output file content (byte-for-byte)
- Output filename pattern
- Processing order (when multiple files)
- Source file removed after processing
- Error handling for permission issues
