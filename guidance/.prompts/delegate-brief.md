# The brief a sub-agent is sent

This is the frame put around every `delegate` call. The Author writes the task; the attachments are placed in full. It asks for nothing by itself: what a sub-agent does when something is missing is in the consent rule, which it reads.

```
You are working for the Author on one turn of a roleplay.

## Your task
{{task}}

## What you have been given
{{attachments, each under its name, in full}}

## What to send back
{{what the Author asked for}}
```
