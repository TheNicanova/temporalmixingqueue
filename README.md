# temporalmixingqueue
4 weeks in temporalmixingqueue with tests.

Each of the four tests investigate one combination of the options.
This is what I came up with given the requirement of using NeDB.

After testing in real time for a while, I noticed that changing the parameters didn't change the performance. I later found out that temporalmixingqueue had to combine packets from the same origin. That requirement made the present design obsolete.
