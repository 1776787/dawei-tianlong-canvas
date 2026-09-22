Option Explicit
Dim shell, files, root, command, result, action
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Environment("PROCESS")("NODE_OPTIONS") = ""
shell.Environment("PROCESS")("NODE_PATH") = ""
action = ""
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "--stop" Then action = " --stop"
End If
command = Quote(files.BuildPath(root, "runtime\node.exe")) & " " & Quote(files.BuildPath(root, "runtime\app.cjs")) & action
result = shell.Run(command, 0, True)
If result <> 0 Then
    shell.Popup "Canvas could not start or stop. The configured port (default 3001) may be occupied. Close the previous version, or run diagnose.bat for details.", 0, "Dawei Tianlong Canvas", 16
End If
WScript.Quit result
Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
